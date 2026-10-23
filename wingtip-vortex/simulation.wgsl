struct Params {
    dims: vec4u, // x, y, z, cells
    flow: vec4f, // U, tau, Cs, incidence
    origin: vec4f, // physical domain origin and dx, root chord = 1
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage,read> source: array<u32>;
@group(0) @binding(2) var<storage,read_write> destination: array<u32>;
@group(0) @binding(3) var<storage,read> flags: array<u32>;
@group(0) @binding(4) var<storage,read_write> field: array<vec4f>;
@group(0) @binding(5) var velocity: texture_storage_3d<rgba16float,write>;
@group(0) @binding(6) var vortex: texture_storage_3d<rgba16float,write>;
@group(0) @binding(7) var<storage,read_write> forcePartials:array<vec4f>;
override optimized: bool = false;
override compressed: bool = false;
override write_field: bool = false;
override shear_test: bool = false;
override tiled:bool=false;
override wg_x:u32=128u;
override wg_y:u32=1u;
override wg_z:u32=1u;
const c = array<vec3i,19>(vec3i(0,0,0),vec3i(1,0,0),vec3i(-1,0,0),vec3i(0,1,0),vec3i(0,-1,0),vec3i(0,0,1),vec3i(0,0,-1),vec3i(1,1,0),vec3i(-1,-1,0),vec3i(1,-1,0),vec3i(-1,1,0),vec3i(1,0,1),vec3i(-1,0,-1),vec3i(1,0,-1),vec3i(-1,0,1),vec3i(0,1,1),vec3i(0,-1,-1),vec3i(0,1,-1),vec3i(0,-1,1));
const opp = array<u32,19>(0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15,18,17);
const w = array<f32,19>(1./3.,1./18.,1./18.,1./18.,1./18.,1./18.,1./18.,1./36.,1./36.,1./36.,1./36.,1./36.,1./36.,1./36.,1./36.,1./36.,1./36.,1./36.,1./36.);
fn idx(pos: vec3i) -> u32 { return u32(pos.x)+p.dims.x*(u32(pos.y)+p.dims.y*u32(pos.z)); }
fn pos(i: u32) -> vec3i { return vec3i(vec3u(i%p.dims.x,(i/p.dims.x)%p.dims.y,i/(p.dims.x*p.dims.y))); }
fn wind() -> vec3f { return p.flow.x*vec3f(cos(p.flow.w),0,sin(p.flow.w)); }
fn eq(q:u32, rho:f32, u:vec3f) -> f32 {
    let cu=dot(vec3f(c[q]),u);
    return w[q]*rho*(1+3*cu+4.5*cu*cu-1.5*dot(u,u));
}
fn load(q:u32,i:u32)->f32{
    if(compressed){
        let pair=unpack2x16float(source[(q/2u)*p.dims.w+i])/32768.;
        return pair[q%2u]+w[q];
    }
    return bitcast<f32>(source[q*p.dims.w+i]);
}
fn store(i:u32,f:array<f32,19>){
    if(compressed){
        for(var q=0u;q<19u;q+=2u){let other=min(q+1u,18u);destination[(q/2u)*p.dims.w+i]=pack2x16float(vec2f(f[q]-w[q],f[other]-w[other])*32768.);}
    }else{for(var q=0u;q<19u;q++){destination[q*p.dims.w+i]=bitcast<u32>(f[q]);}}
    if(write_field){
        var rho=0.;var u=vec3f(0);
        for(var q=0u;q<19u;q++){let a=f[q];rho+=a;u+=a*vec3f(c[q]);}
        u/=rho;field[i]=vec4f(u,rho);
        textureStore(velocity,pos(i),vec4f(u/p.flow.x,2*(rho-1)/(3*p.flow.x*p.flow.x)));
    }
}
@compute @workgroup_size(128)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
    let i=id.x+id.y*4194304u; if(i>=p.dims.w){return;}
    var u=wind();if(shear_test){u.x+=.1*p.flow.x*sin(6.28318530718*(f32(pos(i).z)+.5)/f32(p.dims.z));}
    var f:array<f32,19>;for(var q=0u;q<19u;q++){f[q]=eq(q,1,u);}store(i,f);
    field[i]=vec4f(wind(),1);
}
@compute @workgroup_size(wg_x,wg_y,wg_z)
fn step(@builtin(global_invocation_id) id: vec3u) {
    var i=id.x+id.y*4194304u;var cell=pos(i);
    if(tiled){if(any(id>=p.dims.xyz)){return;}cell=vec3i(id);i=idx(cell);}
    if(i>=p.dims.w || (flags[i]&0x80000000u)!=0u){return;}
    let dims=vec3i(p.dims.xyz);
    let far=any(cell==vec3i(0)) || cell.y==dims.y-1 || cell.z==dims.z-1;
    if(far && !shear_test){var f:array<f32,19>;for(var q=0u;q<19u;q++){f[q]=eq(q,1,wind());}store(i,f);return;}
    if(cell.x==dims.x-1 && !shear_test){
        let j=idx(cell-vec3i(1,0,0));
        var f:array<f32,19>;for(var q=0u;q<19u;q++){f[q]=load(q,j);}store(i,f);return;
    }
    var f:array<f32,19>; var rho=0.; var m=vec3f(0);
    var xx=0.;var yy=0.;var zz=0.;var xy=0.;var xz=0.;var yz=0.;
    for(var q=0u;q<19u;q++){
        var neighbor=cell-c[q];if(shear_test){neighbor=(neighbor+dims)%dims;}let j=idx(neighbor);
        var wall=false;
        if(optimized){wall=(flags[i]&(1u<<q))!=0u;}else{wall=(flags[j]&0x80000000u)!=0u || (flags[i]&(1u<<q))!=0u;}
        if(optimized){
            if(wall){f[q]=load(opp[q],i);}else{f[q]=load(q,j);}
        }else{f[q]=select(load(q,j),load(opp[q],i),wall);}
        let e=vec3f(c[q]);let a=f[q];rho+=a;m+=a*e;
        xx+=a*e.x*e.x; yy+=a*e.y*e.y; zz+=a*e.z*e.z;
        xy+=a*e.x*e.y; xz+=a*e.x*e.z; yz+=a*e.y*e.z;
    }
    let u=m/rho;
    xx-=rho*(1./3.+u.x*u.x); yy-=rho*(1./3.+u.y*u.y); zz-=rho*(1./3.+u.z*u.z);
    xy-=rho*u.x*u.y; xz-=rho*u.x*u.z; yz-=rho*u.y*u.z;
    let norm=sqrt(2*(xx*xx+yy*yy+zz*zz+2*(xy*xy+xz*xz+yz*yz)));
    let tau=0.5*(p.flow.y+sqrt(p.flow.y*p.flow.y+18*p.flow.z*p.flow.z*norm/rho));
    let relax=1-1/tau;
    // Sponge is outside the wing/wake region, at the lateral and outflow boundaries.
    let edge=min(min(f32(cell.y),f32(dims.y-1-cell.y)),min(f32(cell.z),f32(dims.z-1-cell.z)));
    let sponge=select(0.04*max(0.,1-edge/8.)+0.04*max(0.,1-f32(dims.x-1-cell.x)/10.),0.,shear_test);
    var output:array<f32,19>;
    for(var q=0u;q<19u;q++){
        let e=vec3f(c[q]);
        let neq=4.5*w[q]*((e.x*e.x-1./3.)*xx+(e.y*e.y-1./3.)*yy+(e.z*e.z-1./3.)*zz+2*(e.x*e.y*xy+e.x*e.z*xz+e.y*e.z*yz));
        output[q]=mix(eq(q,rho,u)+relax*neq,eq(q,1,wind()),sponge);
    }
    store(i,output);
}
@compute @workgroup_size(128)
fn extract(@builtin(global_invocation_id) id: vec3u) {
    let i=id.x+id.y*4194304u; if(i>=p.dims.w){return;}
    var rho=0.;var u=vec3f(0);
    for(var q=0u;q<19u;q++){let a=load(q,i);rho+=a;u+=a*vec3f(c[q]);}
    if((flags[i]&0x80000000u)!=0u){rho=1;u=vec3f(0);}
    u/=rho;field[i]=vec4f(u,rho);
    textureStore(velocity,pos(i),vec4f(u/p.flow.x,2*(rho-1)/(3*p.flow.x*p.flow.x)));
}
var<workgroup> forceSums:array<vec4f,128>;
@compute @workgroup_size(128)
fn forces(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) local:u32,@builtin(workgroup_id) group:vec3u){
    let i=id.x+id.y*4194304u;var force=vec3f(0);
    if(i<p.dims.w && (flags[i]&0x80000000u)==0u){
        for(var q=1u;q<19u;q++){if((flags[i]&(1u<<q))!=0u){force-=2*load(opp[q],i)*vec3f(c[q]);}}
    }
    forceSums[local]=vec4f(force,0);workgroupBarrier();
    for(var stride=64u;stride>0u;stride/=2u){if(local<stride){forceSums[local]+=forceSums[local+stride];}workgroupBarrier();}
    if(local==0u){forcePartials[group.x+group.y*32768u]=forceSums[0];}
}
fn v(a:vec3i)->vec3f{return field[idx(clamp(a,vec3i(0),vec3i(p.dims.xyz)-1))].xyz;}
@compute @workgroup_size(128)
fn curl(@builtin(global_invocation_id) id: vec3u) {
    let i=id.x+id.y*4194304u; if(i>=p.dims.w){return;}
    let a=pos(i);let scale=0.5/(p.origin.w*p.flow.x);
    let gx=(v(a+vec3i(1,0,0))-v(a-vec3i(1,0,0)))*scale;
    let gy=(v(a+vec3i(0,1,0))-v(a-vec3i(0,1,0)))*scale;
    let gz=(v(a+vec3i(0,0,1))-v(a-vec3i(0,0,1)))*scale;
    let omega=vec3f(gy.z-gz.y,gz.x-gx.z,gx.y-gy.x);
    let strain=gx.x*gx.x+gy.y*gy.y+gz.z*gz.z+0.5*((gy.x+gx.y)*(gy.x+gx.y)+(gz.x+gx.z)*(gz.x+gx.z)+(gz.y+gy.z)*(gz.y+gy.z));
    let Q=0.25*dot(omega,omega)-0.5*strain;
    textureStore(vortex,a,vec4f(omega.x,length(omega),Q,select(0.,1.,(flags[i]&0x80000000u)!=0u)));
}
