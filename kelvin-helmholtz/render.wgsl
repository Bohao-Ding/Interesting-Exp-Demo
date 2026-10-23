struct Params {
    nx:u32,ny:u32,cells:u32,view:u32,
    u0:f32,nu:f32,omega_plus:f32,omega_minus:f32,
    dt:f32,kappa:f32,time:f32,arrows:f32,camera:vec4f,initial:vec4f,
}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> field:array<vec4f>;
struct Vertex { @builtin(position) position:vec4f,@location(0) uv:vec2f }
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->Vertex {
    let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
    var out:Vertex;out.position=vec4f(positions[i],0,1);out.uv=positions[i]*0.5+0.5;return out;
}
fn index(pos:vec2i)->u32 {
    let z=(pos+vec2i(i32(p.nx),i32(p.ny)))%vec2i(i32(p.nx),i32(p.ny));return u32(z.y)*p.nx+u32(z.x);
}
fn value(pos:vec2f)->vec4f {
    let cell=vec2i(floor(pos));let t=fract(pos);
    return mix(mix(field[index(cell)],field[index(cell+vec2i(1,0))],t.x),mix(field[index(cell+vec2i(0,1))],field[index(cell+vec2i(1,1))],t.x),t.y);
}
fn speed_color(v:f32)->vec3f {
    let t=clamp(v/1.4,0,1)*5;
    let colors=array<vec3f,6>(vec3f(0.015,0.04,0.12),vec3f(0.04,0.24,0.5),vec3f(0.0,0.65,0.7),vec3f(0.5,0.8,0.45),vec3f(1.0,0.7,0.2),vec3f(0.93,0.19,0.22));
    let i=min(u32(t),4u);return mix(colors[i],colors[i+1u],t-f32(i));
}
@fragment fn flow(in:Vertex)->@location(0) vec4f {
    let aspect=p.camera.w;
    let fit=vec2f(max(aspect/2.0,1.0),max(2.0/aspect,1.0));
    let uv=(in.uv-0.5)*fit/p.camera.z+p.camera.xy;
    if(any(uv<vec2f(0))||any(uv>vec2f(1))){return vec4f(0.02,0.035,0.055,1);}
    let pos=uv*vec2f(f32(p.nx),f32(p.ny))-0.5;
    let f=value(pos);
    let curl=0.5*(value(pos+vec2f(1,0)).y-value(pos-vec2f(1,0)).y-value(pos+vec2f(0,1)).x+value(pos-vec2f(0,1)).x)*f32(p.ny)/p.u0;
    var color:vec3f;
    if(p.view==0u) {
        let phi=clamp(f.w,0,1);
        let cold=vec3f(0.035,0.42,0.56);let warm=vec3f(0.98,0.38,0.17);
        color=mix(cold,warm,smoothstep(0.03,0.97,phi));
        let stripes=pow(0.5+0.5*cos(phi*100.53),10.0);
        let mixed=4.0*phi*(1.0-phi);
        color*=0.72+0.28*stripes*mixed;
        color+=vec3f(0.05,0.1,0.10)*mixed;
    } else if(p.view==1u) {
        let strength=pow(clamp(abs(curl)/35.0,0,1),0.6);
        color=mix(vec3f(0.024,0.055,0.08),select(vec3f(0.05,0.64,0.90),vec3f(1.0,0.35,0.20),curl>0),strength);
    } else {color=speed_color(length(f.xy)/p.u0);}
    if(p.arrows>0.5) {
        let spacing=max(7.0,36.0/p.camera.z);
        let center=(floor(pos/spacing)+0.5)*spacing;
        let velocity=value(center).xy;let dir=normalize(velocity+vec2f(0.000001));
        let rel=(pos-center)*p.camera.z;
        let loc=vec2f(dot(rel,dir),dot(rel,vec2f(-dir.y,dir.x)));
        let shaft=max(abs(loc.x+1.0)-4.5,abs(loc.y)-0.35);
        let head=max(abs(loc.y)-2.8,max(abs(loc.y)+loc.x-5.0,-loc.x+1.0));
        let arrow=1-smoothstep(-0.15,0.6,min(shaft,head));
        color=mix(color,vec3f(0.87,0.96,0.97),arrow*0.65*smoothstep(0.1,0.5,length(velocity)/p.u0));
    }
    return vec4f(color,1);
}
