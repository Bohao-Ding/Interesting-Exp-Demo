struct Params {origin:vec4f,size:vec4f}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var velocity:texture_3d<f32>;
@group(0) @binding(2) var linearSampler:sampler;
@group(0) @binding(3) var<storage,read> seeds:array<vec4f>;
@group(0) @binding(4) var<storage,read_write> lines:array<vec4f>;
fn sampleVelocity(a:vec3f)->vec3f {
    return textureSampleLevel(velocity,linearSampler,(a-p.origin.xyz)/p.size.xyz,0).xyz;
}
@compute @workgroup_size(64)
fn trace(@builtin(global_invocation_id) id:vec3u){
    let i=id.x;if(i>=arrayLength(&seeds)){return;}
    var a=seeds[i].xyz;
    for(var k=0u;k<128u;k++){
        let v=sampleVelocity(a);lines[i*128u+k]=vec4f(a,length(v));
        let dt=.045/max(length(v),.15);
        let mid=a+.5*dt*v;
        let next=a+dt*sampleVelocity(mid);
        if(all(next>p.origin.xyz) && all(next<p.origin.xyz+p.size.xyz) && length(v)>.05){a=next;}
    }
}
