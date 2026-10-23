struct Params {
    nx: u32, ny: u32, cells: u32, view: u32,
    cx: f32, cy: f32, radius: f32, u0: f32,
    omega_plus: f32, omega_minus: f32, steps: f32, dt: f32,
    trails: f32, aspect: f32, frame: f32, padding: f32, camera: vec4f,
}
struct Previous {
    nx: u32, ny: u32, cells: u32, unused: u32,
    scale: f32, even_scale: f32, odd_scale: f32, padding: f32,
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<uniform> old: Previous;
@group(0) @binding(2) var<storage,read> source: array<f32>;
@group(0) @binding(3) var<storage,read_write> destination: array<f32>;
const c = array<vec2f,9>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(-1,0),vec2f(0,-1),vec2f(1,1),vec2f(-1,1),vec2f(-1,-1),vec2f(1,-1));
const w = array<f32,9>(4.0/9.0,1.0/9.0,1.0/9.0,1.0/9.0,1.0/9.0,1.0/36.0,1.0/36.0,1.0/36.0,1.0/36.0);
const opposite = array<u32,9>(0,3,4,1,2,7,8,5,6);
fn eq(q: u32, rho: f32, u: vec2f) -> f32 {
    let cu=dot(c[q],u);
    return w[q]*rho*(1+3*cu+4.5*cu*cu-1.5*dot(u,u));
}
@compute @workgroup_size(16,16)
fn remesh(@builtin(global_invocation_id) id: vec3u) {
    if (id.x>=p.nx || id.y>=p.ny) { return; }
    let i=id.y*p.nx+id.x;
    if (distance(vec2f(id.xy),vec2f(p.cx,p.cy))<=p.radius) {
        for (var q=0u;q<9u;q++) { destination[q*p.cells+i]=w[q]; }
        return;
    }
    let pos=clamp(vec2f(id.xy)/old.scale,vec2f(0),vec2f(f32(old.nx)-1.001,f32(old.ny)-1.001));
    let cell=vec2u(pos); let t=fract(pos); let k=cell.y*old.nx+cell.x;
    var f: array<f32,9>; var equilibria: array<f32,9>;
    var rho=0.0; var momentum=vec2f(0);
    for (var q=0u;q<9u;q++) {
        let offset=q*old.cells+k;
        f[q]=mix(mix(source[offset],source[offset+1u],t.x),mix(source[offset+old.nx],source[offset+old.nx+1u],t.x),t.y);
        rho+=f[q]; momentum+=f[q]*c[q];
    }
    let u=momentum/rho;
    for (var q=0u;q<9u;q++) { equilibria[q]=eq(q,rho,u); }
    // Rescale post-collision non-equilibrium modes under acoustic scaling.
    // Collision populations use (tau - 1), rather than the pre-collision tau factor.
    for (var q=0u;q<9u;q++) {
        let o=opposite[q];
        let a=f[q]-equilibria[q]; let b=f[o]-equilibria[o];
        destination[q*p.cells+i]=equilibria[q]+0.5*(a+b)*old.even_scale+0.5*(a-b)*old.odd_scale;
    }
}
