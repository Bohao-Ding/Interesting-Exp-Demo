struct Camera { viewport:vec4f, frame:vec4f, look:vec4f }
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> electric:array<vec2f>;
@group(0) @binding(2) var<storage,read> intensity:array<f32>;
@group(0) @binding(3) var<storage,read> edits:array<f32>;
@group(0) @binding(4) var<uniform> camera:Camera;
@vertex fn screen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
    let a=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(a[i],0,1);
}
fn field(cell:vec2i)->vec2f{
    let a=vec2u(clamp(cell,vec2i(0),vec2i(p.dims.xy)-1));let i=a.x+p.dims.x*a.y;
    return vec2f(electric[i].x+electric[i].y,intensity[i]);
}
@fragment fn color(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let css=pixel.xy/camera.viewport.z;
    let center=vec2f((camera.viewport.x-camera.viewport.w)*.5,camera.viewport.y*.55);
    let world=camera.frame.xy+vec2f(css.x-center.x,center.y-css.y)/camera.frame.z;
    let base=vec3f(.018,.028,.046);
    if(any(world<p.domain.xy)||any(world>p.domain.xy+p.domain.zw)){return vec4f(base,1);}
    let cell=(world-p.domain.xy)/p.grid.x-.5;let a=vec2i(floor(cell));let t=fract(cell);
    let f=mix(mix(field(a),field(a+vec2i(1,0)),t.x),mix(field(a+vec2i(0,1)),field(a+vec2i(1,1)),t.x),t.y);
    let envelope=1.-exp(-sqrt(max(0.,f.y))*camera.look.x);
    let value=tanh(f.x*camera.look.x);
    var result=base+vec3f(.018,.04,.055)*envelope;
    if(camera.frame.w<.5){
        let light=select(vec3f(.045,.48,1.),vec3f(1.,.39,.08),value>=0.);
        result+=light*pow(abs(value),.7)+vec3f(.05,.12,.14)*envelope;
    }else{
        let light=mix(vec3f(.10,.24,.70),vec3f(1.,.50,.11),smoothstep(.15,.75,envelope));
        result+=light*envelope+vec3f(.22,.38,.33)*pow(envelope,5.);
    }
    let rod=vec2i(round(world));let r=radius(rod);let distance=length(world-vec2f(rod));
    let aa=1.2/camera.frame.z;
    if(r>0.){
        let inside=1.-smoothstep(r-aa,r+aa,distance);
        let edge=1.-smoothstep(aa,2.*aa,abs(distance-r));
        result=mix(result,result*.84+vec3f(.045,.06,.065),inside);
        result+=vec3f(.14,.23,.28)*edge;
    }else if(abs(rod.x)<=12&&abs(rod.y)<=8){
        let mark=1.-smoothstep(.015,.015+aa,distance);result+=vec3f(.10,.21,.22)*mark;
    }
    let boundary=min(min(world.x+16.,16.-world.x),min(world.y+12.,12.-world.y));
    result=mix(result,result*.65,(1.-smoothstep(0.,2.,boundary))*.7);
    let sourceDistance=length((world-p.structure.zw)/vec2f(.15,.5));
    result+=vec3f(.22,.8,.7)*exp(-sourceDistance*sourceDistance)*.45*p.grid.w;
    return vec4f(result,1);
}
