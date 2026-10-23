struct Params {
    nx: u32, ny: u32, cells: u32, view: u32,
    u0: f32, nu: f32, omega_plus: f32, omega_minus: f32,
    dt: f32, kappa: f32, time: f32, arrows: f32,
    camera: vec4f,
    initial: vec4f,
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage,read> source: array<f32>;
@group(0) @binding(2) var<storage,read_write> destination: array<f32>;
@group(0) @binding(3) var<storage,read_write> field: array<vec4f>;
@group(0) @binding(4) var<storage,read> dye: array<f32>;
@group(0) @binding(5) var<storage,read_write> next_dye: array<f32>;
override test_mode: u32 = 0u;
const c = array<vec2i,9>(vec2i(0,0),vec2i(1,0),vec2i(0,1),vec2i(-1,0),vec2i(0,-1),vec2i(1,1),vec2i(-1,1),vec2i(-1,-1),vec2i(1,-1));
const w = array<f32,9>(4.0/9.0,1.0/9.0,1.0/9.0,1.0/9.0,1.0/9.0,1.0/36.0,1.0/36.0,1.0/36.0,1.0/36.0);
const opposite = array<u32,9>(0,3,4,1,2,7,8,5,6);
const PI = 3.141592653589793;
fn index(pos: vec2i) -> u32 {
    let z = (pos+vec2i(i32(p.nx),i32(p.ny)))%vec2i(i32(p.nx),i32(p.ny));
    return u32(z.y)*p.nx+u32(z.x);
}
fn equilibrium(q: u32, rho: f32, u: vec2f) -> f32 {
    let cu = dot(vec2f(c[q]),u);
    return w[q]*rho*(1+3*cu+4.5*cu*cu-1.5*dot(u,u));
}
@compute @workgroup_size(16,16)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
    if (id.x>=p.nx || id.y>=p.ny) { return; }
    let i=id.y*p.nx+id.x;
    let x=(f32(id.x)+0.5)/f32(p.nx); let y=(f32(id.y)+0.5)/f32(p.ny);
    let band=0.5*(tanh((y-0.25)/p.initial.x)-tanh((y-0.75)/p.initial.x));
    var phi=band;
    var u=vec2f(p.u0*(2*band-1), p.u0*p.initial.z*(sin(2*PI*p.initial.y*x)+0.35*sin(4*PI*x+0.3)+0.1*sin(2*PI*x+0.7)));
    if (test_mode==1u) { u=vec2f(p.u0*sin(2*PI*y),0); phi=0.5; }
    if (test_mode==2u) { u=vec2f(p.u0,0); phi=0.5+0.2*sin(2*PI*x); }
    for (var q=0u;q<9u;q++) { destination[q*p.cells+i]=equilibrium(q,1,u); }
    next_dye[i]=phi; field[i]=vec4f(u,1,phi);
}
@compute @workgroup_size(16,16)
fn collide_stream(@builtin(global_invocation_id) id: vec3u) {
    if (id.x>=p.nx || id.y>=p.ny) { return; }
    let i=id.y*p.nx+id.x; let pos=vec2i(id.xy);
    var f: array<f32,9>; var eq: array<f32,9>;
    var rho=0.0; var momentum=vec2f(0);
    for (var q=0u;q<9u;q++) {
        f[q]=source[q*p.cells+index(pos-c[q])];
        rho+=f[q]; momentum+=f[q]*vec2f(c[q]);
    }
    let u=momentum/rho;
    for (var q=0u;q<9u;q++) { eq[q]=equilibrium(q,rho,u); }
    for (var q=0u;q<9u;q++) {
        let o=opposite[q];
        let even=0.5*((f[q]+f[o])-(eq[q]+eq[o]));
        let odd=0.5*((f[q]-f[o])-(eq[q]-eq[o]));
        destination[q*p.cells+i]=f[q]-p.omega_plus*even-p.omega_minus*odd;
    }
}
@compute @workgroup_size(16,16)
fn extract_field(@builtin(global_invocation_id) id: vec3u) {
    if (id.x>=p.nx || id.y>=p.ny) { return; }
    let i=id.y*p.nx+id.x; var rho=0.0; var momentum=vec2f(0);
    for (var q=0u;q<9u;q++) { let f=source[q*p.cells+i]; rho+=f; momentum+=f*vec2f(c[q]); }
    field[i]=vec4f(momentum/rho,rho,dye[i]);
}
fn slope(a: f32,b: f32,c: f32) -> f32 {
    let left=b-a; let right=c-b;
    if (left*right<=0) { return 0; }
    return sign(left)*min(0.5*abs(c-a),2*min(abs(left),abs(right)));
}
fn concentration(pos: vec2i) -> f32 { return dye[index(pos)]; }
fn flux(pos: vec2i,axis: vec2i) -> f32 {
    let a=concentration(pos-axis); let b=concentration(pos);
    let d=concentration(pos+axis); let e=concentration(pos+2*axis);
    let velocity=0.5*dot(field[index(pos)].xy+field[index(pos+axis)].xy,vec2f(axis));
    return velocity*select(d-0.5*slope(b,d,e),b+0.5*slope(a,b,d),velocity>=0);
}
fn rhs(pos: vec2i) -> f32 {
    let ex=vec2i(1,0); let ey=vec2i(0,1); let q=concentration(pos);
    let divergence=0.5*(field[index(pos+ex)].x-field[index(pos-ex)].x+field[index(pos+ey)].y-field[index(pos-ey)].y);
    let lap=concentration(pos+ex)+concentration(pos-ex)+concentration(pos+ey)+concentration(pos-ey)-4*q;
    return -(flux(pos,ex)-flux(pos-ex,ex)+flux(pos,ey)-flux(pos-ey,ey))+q*divergence+p.kappa*lap;
}
@compute @workgroup_size(16,16)
fn dye_predict(@builtin(global_invocation_id) id: vec3u) {
    if (id.x>=p.nx || id.y>=p.ny) { return; }
    let i=id.y*p.nx+id.x; next_dye[i]=dye[i]+p.dt*rhs(vec2i(id.xy));
}
@compute @workgroup_size(16,16)
fn dye_correct(@builtin(global_invocation_id) id: vec3u) {
    if (id.x>=p.nx || id.y>=p.ny) { return; }
    let i=id.y*p.nx+id.x; next_dye[i]=0.5*(next_dye[i]+dye[i]+p.dt*rhs(vec2i(id.xy)));
}
