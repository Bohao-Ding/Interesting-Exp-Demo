struct Scene {eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,origin:vec4f,size:vec4f,display:vec4f,settings:vec4f}
@group(0) @binding(0) var<uniform> s:Scene;
@group(0) @binding(1) var velocity:texture_3d<f32>;
@group(0) @binding(2) var vortex:texture_3d<f32>;
@group(0) @binding(3) var linearSampler:sampler;
@group(0) @binding(4) var depth:texture_depth_2d;
@group(0) @binding(5) var<storage,read> lines:array<vec4f>;
fn project(world:vec3f)->vec4f {
    let a=world-s.eye.xyz;let z=dot(a,s.forward.xyz);let near=0.02;let far=40.;
    return vec4f(dot(a,s.right.xyz)/(s.right.w*s.up.w)-s.settings.w*z,dot(a,s.up.xyz)/s.up.w,
        far/(far-near)*z-near*far/(far-near),z);
}
fn coord(world:vec3f)->vec3f{return (world-s.origin.xyz)/s.size.xyz;}
fn diverging(a:f32)->vec3f {
    return mix(vec3f(.05,.66,1.),vec3f(1.,.36,.08),smoothstep(-.05,.05,a));
}
struct MeshVertex { @builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) material:f32 }
@vertex fn meshVertex(@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) material:f32)->MeshVertex {
    var out:MeshVertex;out.position=project(world);out.world=world;out.normal=normal;out.material=material;return out;
}
@fragment fn meshFragment(in:MeshVertex)->@location(0) vec4f {
    var n=normalize(in.normal);if(dot(n,s.eye.xyz-in.world)<0){n=-n;}
    var color=vec3f(.71,.78,.84);
    if(in.material>.5){color=select(vec3f(.98,.59,.15),vec3f(.13,.78,.8),in.material>1.5);}
    if(s.settings.x>.5 && in.material<.5){
        let cp=textureSampleLevel(velocity,linearSampler,coord(in.world+n*s.origin.w*1.6),0).w;
        color=mix(vec3f(.14,.42,.9),vec3f(1.,.38,.12),smoothstep(-1.3,.6,cp));
    }
    let light=.35+.65*max(0.,dot(n,normalize(vec3f(-.4,-.6,1.))));
    let rim=pow(1-abs(dot(n,normalize(s.eye.xyz-in.world))),3.);
    return vec4f(color*light+rim*.12,1);
}
@vertex fn screen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
    let a=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(a[i],0,1);
}
@fragment fn volume(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let dimensions=vec2f(textureDimensions(depth));
    let uv=vec2f(2*pixel.x/dimensions.x-1,1-2*pixel.y/dimensions.y);
    let ray=normalize(s.forward.xyz+(uv.x+s.settings.w)*s.right.w*s.up.w*s.right.xyz+uv.y*s.up.w*s.up.xyz);
    let a=(s.origin.xyz-s.eye.xyz)/ray;let b=(s.origin.xyz+s.size.xyz-s.eye.xyz)/ray;
    let lo=min(a,b);let hi=max(a,b);
    var start=max(0.,max(lo.x,max(lo.y,lo.z)));var stop=min(hi.x,min(hi.y,hi.z));
    let z=textureLoad(depth,vec2i(pixel.xy),0);
    if(z<.999999){let d=.02*40./(40.-z*(40.-.02));stop=min(stop,d/dot(ray,s.forward.xyz));}
    if(stop<=start){return vec4f(0);}
    let h=(stop-start)/192.;var rgb=vec3f(0);var alpha=0.;
    for(var j=0u;j<192u;j++){
        let world=s.eye.xyz+(start+(f32(j)+.5)*h)*ray;
        if(world.x<s.settings.y || abs(world.y)<s.settings.z){continue;}
        let v=textureSampleLevel(vortex,linearSampler,coord(world),0);
        if(v.w>.05){continue;}
        var density=max(0.,v.z-s.display.y);
        if(s.display.x>.5){density=max(0.,v.y-s.display.y*3.)*.35;}
        let amount=1-exp(-log(1+density)*h*s.display.z);
        let color=diverging(v.x)*(.7+.3*smoothstep(0.,10.,v.y));
        rgb+=(1-alpha)*amount*color;alpha+=(1-alpha)*amount;
        if(alpha>.97){break;}
    }
    return vec4f(rgb,alpha);
}
@fragment fn backdrop(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let size=vec2f(textureDimensions(depth));let uv=vec2f(2*pixel.x/size.x-1,1-2*pixel.y/size.y);
    let ray=normalize(s.forward.xyz+(uv.x+s.settings.w)*s.right.w*s.up.w*s.right.xyz+uv.y*s.up.w*s.up.xyz);
    var color=mix(vec3f(.014,.023,.04),vec3f(.035,.058,.085),clamp(.5+.5*uv.y,0.,1.));
    let t=(-.65-s.eye.z)/ray.z;
    if(t>0 && ray.z<0){
        let world=s.eye.xyz+t*ray;let grid=abs(fract(world.xy*2-.5)-.5);
        let edge=1-smoothstep(.008,.025,min(grid.x,grid.y));
        color+=edge*.028*exp(-.03*t*t);
    }
    return vec4f(color,1);
}
struct LineVertex {@builtin(position) position:vec4f,@location(0) color:vec3f,@location(1) fade:f32}
@vertex fn lineVertex(@builtin(vertex_index) i:u32)->LineVertex {
    let line=i/2u;let seed=line/127u;let segment=line%127u;
    let a=lines[seed*128u+segment+i%2u];
    var out:LineVertex;out.position=project(a.xyz);out.color=mix(vec3f(.12,.64,.9),vec3f(.96,.85,.49),clamp((a.w-.4)/1.2,0.,1.));
    out.fade=.32+.6*pow(.5+.5*sin(f32(segment)*.2-s.display.w*3.),5.);return out;
}
@fragment fn lineFragment(in:LineVertex)->@location(0) vec4f{return vec4f(in.color,in.fade);}
