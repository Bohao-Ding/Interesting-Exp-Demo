struct Params {
    nx: u32, ny: u32, cells: u32, view: u32,
    u0: f32, nu: f32, omega_plus: f32, omega_minus: f32,
    dt: f32, kappa: f32, time: f32, arrows: f32, camera: vec4f, initial: vec4f,
}
struct Previous { nx: u32,ny: u32,cells: u32,unused: u32,scale: f32,even_scale: f32,odd_scale: f32,padding: f32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<uniform> old: Previous;
@group(0) @binding(2) var<storage,read> source: array<f32>;
@group(0) @binding(3) var<storage,read> old_field: array<vec4f>;
@group(0) @binding(4) var<storage,read_write> destination: array<f32>;
@group(0) @binding(5) var<storage,read_write> dye: array<f32>;
const c=array<vec2f,9>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(-1,0),vec2f(0,-1),vec2f(1,1),vec2f(-1,1),vec2f(-1,-1),vec2f(1,-1));
const w=array<f32,9>(4.0/9.0,1.0/9.0,1.0/9.0,1.0/9.0,1.0/9.0,1.0/36.0,1.0/36.0,1.0/36.0,1.0/36.0);
const opposite=array<u32,9>(0,3,4,1,2,7,8,5,6);
fn index(pos: vec2i) -> u32 {
    let z=(pos+vec2i(i32(old.nx),i32(old.ny)))%vec2i(i32(old.nx),i32(old.ny));
    return u32(z.y)*old.nx+u32(z.x);
}
fn eq(q:u32,rho:f32,u:vec2f)->f32 {
    let cu=dot(c[q],u); return w[q]*rho*(1+3*cu+4.5*cu*cu-1.5*dot(u,u));
}
@compute @workgroup_size(16,16)
fn remesh(@builtin(global_invocation_id) id:vec3u) {
    if(id.x>=p.nx||id.y>=p.ny){return;}
    let i=id.y*p.nx+id.x; let pos=(vec2f(id.xy)+0.5)/old.scale-0.5;
    let cell=vec2i(floor(pos)); let t=fract(pos);
    let a=index(cell); let b=index(cell+vec2i(1,0));
    let d=index(cell+vec2i(0,1)); let e=index(cell+vec2i(1,1));
    var f:array<f32,9>; var equilibria:array<f32,9>; var rho=0.0; var momentum=vec2f(0);
    for(var q=0u;q<9u;q++) {
        let k=q*old.cells;
        f[q]=mix(mix(source[k+a],source[k+b],t.x),mix(source[k+d],source[k+e],t.x),t.y);
        rho+=f[q]; momentum+=f[q]*c[q];
    }
    for(var q=0u;q<9u;q++){equilibria[q]=eq(q,rho,momentum/rho);}
    for(var q=0u;q<9u;q++) {
        let o=opposite[q]; let fa=f[q]-equilibria[q]; let fb=f[o]-equilibria[o];
        destination[q*p.cells+i]=equilibria[q]+0.5*(fa+fb)*old.even_scale+0.5*(fa-fb)*old.odd_scale;
    }
    dye[i]=mix(mix(old_field[a].w,old_field[b].w,t.x),mix(old_field[d].w,old_field[e].w,t.x),t.y);
}
