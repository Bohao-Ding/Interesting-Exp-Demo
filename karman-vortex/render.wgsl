struct Params {
    nx: u32, ny: u32, cells: u32, view: u32,
    cx: f32, cy: f32, radius: f32, u0: f32,
    omega_plus: f32, omega_minus: f32, steps: f32, dt: f32,
    trails: f32, aspect: f32, frame: f32, padding: f32,
    camera: vec4f,
}
struct Particle { points: array<vec2f,8>, age: f32, seed: f32 }
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage,read> field: array<vec4f>;
@group(0) @binding(2) var<storage,read> particles: array<Particle>;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn fullscreen(@builtin(vertex_index) i: u32) -> Vertex {
    let pos = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
    var out: Vertex; out.position = vec4f(pos[i],0,1); out.uv = pos[i]*0.5+0.5; return out;
}
fn value(pos: vec2f) -> vec4f {
    let z = clamp(pos,vec2f(0),vec2f(f32(p.nx)-1.001,f32(p.ny)-1.001));
    let cell = vec2u(z); let a = fract(z); let i = cell.y*p.nx+cell.x;
    return mix(mix(field[i],field[i+1u],a.x),mix(field[i+p.nx],field[i+p.nx+1u],a.x),a.y);
}
fn speed_color(v: f32) -> vec3f {
    let t = clamp(v/1.65,0,1)*5.0;
    let colors = array<vec3f,6>(vec3f(0.028,0.09,0.23),vec3f(0.03,0.36,0.62),vec3f(0.02,0.65,0.65),vec3f(0.52,0.80,0.38),vec3f(1.0,0.66,0.15),vec3f(0.84,0.13,0.20));
    let i = min(u32(t),4u); return mix(colors[i],colors[i+1u],t-f32(i));
}
fn direction_color(angle: f32) -> vec3f {
    return 0.56+0.44*cos(angle+vec3f(0.0,2.094,4.189));
}
@fragment fn flow(in: Vertex) -> @location(0) vec4f {
    // Fit physical aspect ratio, including in fullscreen, without stretching the cylinder.
    let domain_aspect = f32(p.nx)/f32(p.ny);
    let fit = vec2f(max(p.aspect/domain_aspect,1.0),max(domain_aspect/p.aspect,1.0));
    let uv = (in.uv-0.5)*fit/p.camera.z+p.camera.xy;
    if (any(uv<vec2f(0)) || any(uv>vec2f(1))) { return vec4f(0.025,0.043,0.068,1); }
    let pos = uv*vec2f(f32(p.nx),f32(p.ny));
    let f = value(pos); let speed = length(f.xy)/p.u0;
    let d = distance(pos,vec2f(p.cx,p.cy))-p.radius;
    if (d<0.0) {
        let shade = dot(normalize(pos-vec2f(p.cx,p.cy)+vec2f(0.001)),normalize(vec2f(-1,1)));
        let rim = exp(d/1.2);
        return vec4f(vec3f(0.055,0.08,0.105)+0.02*shade+rim*vec3f(0.38,0.48,0.52),1);
    }
    let dx = value(pos+vec2f(1,0)).y-value(pos-vec2f(1,0)).y;
    let dy = value(pos+vec2f(0,1)).x-value(pos-vec2f(0,1)).x;
    let curl = (dx-dy)*p.radius/p.u0;
    var color: vec3f;
    if (p.view == 0u) {
        color = speed_color(speed);
    } else if (p.view == 1u) {
        let strength = pow(clamp(abs(curl)/5.0,0.0,1.0),0.55);
        let cold = mix(vec3f(0.025,0.18,0.31),vec3f(0.12,0.70,0.92),min(strength*1.8,1.0));
        let warm = mix(vec3f(0.28,0.07,0.10),vec3f(1.0,0.33,0.23),min(strength*1.8,1.0));
        color = mix(vec3f(0.026,0.062,0.093),select(cold,warm,curl>0),strength);
        // Subtle vorticity contours make the separated shear layers legible.
        let contour = pow(0.5+0.5*cos(curl*7.0),18.0)*smoothstep(0.25,1.2,abs(curl));
        color += 0.032*contour;
    } else {
        color = direction_color(atan2(f.y,f.x)+3.14159265)*mix(0.13,0.75,clamp(speed,0,1));
    }
    // Sparse, field-aligned chevrons, especially useful in the direction view.
    if (p.view == 2u) {
        let spacing = 23.0;
        let center = (floor(pos/spacing)+0.5)*spacing;
        let u = value(center).xy;
        let dir = normalize(u+vec2f(0.000001));
        let rel = pos-center;
        let local = vec2f(dot(rel,dir),dot(rel,vec2f(-dir.y,dir.x)));
        let shaft = max(abs(local.x+1.0)-4.5,abs(local.y)-0.38);
        let head = max(abs(local.y)-2.8,max(abs(local.y)+local.x-5.0,-local.x+1.0));
        let arrow = 1.0-smoothstep(-0.15,0.7,min(shaft,head));
        color = mix(color,vec3f(0.78,0.90,0.94),arrow*0.55*smoothstep(0.01,0.04,length(u)));
    }
    let edge = 1.0-smoothstep(0,1.3,d);
    color = mix(color,vec3f(0.55,0.70,0.73),edge*0.8);
    return vec4f(color,1);
}

struct TrailVertex { @builtin(position) position: vec4f, @location(0) alpha: f32 }
@vertex fn trail_vertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> TrailVertex {
    let part = particles[instance/7u]; let segment = instance%7u;
    let a = part.points[segment]; let b = part.points[segment+1u];
    let delta = b-a;
    let normal = normalize(vec2f(-delta.y,delta.x)+vec2f(0.00001));
    let corner = array<vec2f,6>(vec2f(0,-1),vec2f(1,-1),vec2f(0,1),vec2f(0,1),vec2f(1,-1),vec2f(1,1))[vertex];
    let pos = mix(a,b,corner.x)+normal*corner.y*0.32;
    let domain_aspect = f32(p.nx)/f32(p.ny);
    let fit = vec2f(min(domain_aspect/p.aspect,1.0),min(p.aspect/domain_aspect,1.0));
    let ndc = (pos/vec2f(f32(p.nx),f32(p.ny))-p.camera.xy)*2.0*p.camera.z*fit;
    var out: TrailVertex; out.position = vec4f(ndc,0,1);
    out.alpha = pow(1.0-(f32(segment)+corner.x)/8.0,1.4)*0.18*p.trails;
    if (length(delta)>25.0) { out.alpha=0; }
    return out;
}
@fragment fn trail_fragment(in: TrailVertex) -> @location(0) vec4f { return vec4f(0.72,0.91,0.94,in.alpha); }
