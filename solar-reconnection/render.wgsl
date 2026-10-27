struct Params { dims:vec4u, grid:vec4f, control:vec4f }
struct Camera { screen:vec4f, world:vec4f, style:vec4f }
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> state:array<vec2f>;
@group(0) @binding(2) var<uniform> camera:Camera;
const PI:f32=3.141592653589793;
@vertex fn screen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
    let vertices=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(vertices[i],0,1);
}
fn at(x:i32,y:i32)->vec2f {let n=i32(p.dims.x);return state[u32((x+n)%n)+p.dims.x*u32((y+n)%n)];}
fn sample(q:vec2f)->vec2f {
    let cell=q/p.grid.x-.5;let c=vec2i(floor(cell));let t=fract(cell);
    return mix(mix(at(c.x,c.y),at(c.x+1,c.y),t.x),mix(at(c.x,c.y+1),at(c.x+1,c.y+1),t.x),t.y);
}
@fragment fn color(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let css=pixel.xy/camera.screen.z;
    let center=vec2f((camera.screen.x-camera.screen.w)*.5,camera.screen.y*.53);
    let q=camera.world.xy+vec2f(css.x-center.x,center.y-css.y)/camera.world.z;
    let base=vec3f(.018,.027,.043);
    if(any(q<vec2f(0.))||any(q>vec2f(2.*PI))){return vec4f(base,1.);}
    let f=sample(q);let dx=vec2f(p.grid.x,0.);let dy=vec2f(0.,p.grid.x);
    let r=sample(q+dx);let l=sample(q-dx);let u=sample(q+dy);let d=sample(q-dy);
    let ax=(r.x-l.x)*.5/p.grid.x;let ay=(u.x-d.x)*.5/p.grid.x;
    let j=-(r.x+l.x+u.x+d.x-4.*f.x)/(p.grid.x*p.grid.x);
    let mode=u32(camera.world.w);let gain=camera.style.x;
    var color=base;
    if(mode==0u){
        let v=1.-exp(-sqrt(p.grid.z)*abs(j)*2.7*gain);
        color+=mix(vec3f(.16,.08,.30),vec3f(1.,.37,.10),smoothstep(.2,.8,v))*v;
        color+=vec3f(.50,.40,.18)*pow(v,4.);
    }else if(mode==1u||mode==2u){
        let raw=select(f.y,j,mode==1u);let v=tanh(raw*select(.3,.18,mode==1u)*gain);
        color+=select(vec3f(.11,.36,.88),vec3f(1.,.37,.11),v>=0.)*pow(abs(v),.8);
    }else{
        let v=1.-exp(-length(vec2f(ax,ay))*gain);
        color+=mix(vec3f(.05,.16,.38),vec3f(.94,.50,.18),v)*v;
    }
    let interval=.13;let distance=abs(fract(f.x/interval+.5)-.5)*interval;
    let width=max(length(vec2f(ax,ay))/camera.world.z*.7,.0002);
    let line=1.-smoothstep(width,width*2.5,distance);
    color+=vec3f(.42,.74,.77)*line*.68;
    let edge=min(min(q.x,q.y),min(2.*PI-q.x,2.*PI-q.y));
    color+=vec3f(.14,.25,.29)*(1.-smoothstep(0.,2./camera.world.z,edge));
    return vec4f(color,1.);
}
