mod profile;

use std::{
    env,
    fmt::Write as FmtWrite,
    fs,
    io::{Read, Write},
    net::TcpListener,
    time::Instant,
};

fn main() {
    let start = Instant::now();
    let p = profile::Profile::new();
    let verification = p.verification();
    if env::args().any(|x| x == "--verify") {
        println!("{verification}");
        println!("{}", p.trajectory_verification());
        return;
    }
    if env::args().any(|x| x == "--export") {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/output");
        fs::create_dir_all(root).unwrap();
        fs::write(format!("{root}/verification.json"), &verification).unwrap();
        fs::write(
            format!("{root}/trajectory_verification.json"),
            p.trajectory_verification(),
        )
        .unwrap();
        for (i, s) in [0.0_f64, 3.0, 6.0, 9.0, 12.0].iter().enumerate() {
            fs::write(format!("{root}/frame_{i}.json"), frame(&p, *s, false)).unwrap();
        }
        println!("Exported verification and 5 computed frames to {root}");
        return;
    }
    let listener = TcpListener::bind("127.0.0.1:8765").expect("port 8765 is in use");
    println!(
        "http://127.0.0.1:8765 -- profile built in {:.3}s",
        start.elapsed().as_secs_f64()
    );
    println!("{verification}");
    for connection in listener.incoming() {
        let Ok(mut stream) = connection else {
            continue;
        };
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
        let mut buffer = [0u8; 8192];
        let Ok(count) = stream.read(&mut buffer) else {
            continue;
        };
        let text = String::from_utf8_lossy(&buffer[..count]);
        let path = text.split_whitespace().nth(1).unwrap_or("/");
        let (status, mime, body) = if path.starts_with("/frame?") || path.starts_with("/frame.bin?") {
            let s = path
                .split("s=")
                .nth(1)
                .and_then(|x| x.split('&').next())
                .and_then(|x| x.parse::<f64>().ok())
                .filter(|x| x.is_finite())
                .unwrap_or(0.0)
                .clamp(0.0, 600.0);
            let binary = path.starts_with("/frame.bin?");
            ("200 OK", if binary { "application/octet-stream" } else { "application/json" }, frame(&p, s, binary))
        } else if path == "/verification" {
            ("200 OK", "application/json", verification.as_bytes().to_vec())
        } else if path == "/" {
            (
                "200 OK",
                "text/html; charset=utf-8",
                fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/index.html")).unwrap(),
            )
        } else {
            ("404 Not Found", "text/plain", b"Not found".to_vec())
        };
        let header=format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",body.len());
        let _ = stream.write_all(header.as_bytes());
        let _ = stream.write_all(&body);
    }
}

fn frame(p: &profile::Profile, s: f64, binary: bool) -> Vec<u8> {
    let start = Instant::now();
    let tau = (-s).exp();
    let (vertices, max_speed, zoom) = p.geometry(tau);
    let paths = p.pathlines(s);
    let omega = paths.omega[1];
    let momentum = paths.momentum[1];
    let radius_ratio = paths.radius_ratio[1];
    let compute_ms = start.elapsed().as_secs_f64() * 1000.0;
    let mut body=format!("{{\"s\":{s},\"tau\":{tau:e},\"time\":{},\"max_sampled_speed\":{max_speed:e},\"zoom\":{zoom:e},\"radial_scale\":{:e},\"axial_scale\":{:e},\"compute_ms\":{compute_ms},\"segments\":{},\"particle_omega\":{omega:e},\"particle_momentum\":{momentum:e},\"particle_radius_ratio\":{radius_ratio:e}",1.0-tau,tau.sqrt(),tau.powf(profile::D),vertices.len()/8);
    write!(&mut body, ",\"lower_omega\":{:e},\"lower_momentum\":{:e},\"upper_omega\":{:e},\"upper_momentum\":{:e},\"window_half_height\":{}", paths.omega[0], paths.momentum[0], paths.omega[1], paths.momentum[1], profile::Z_HALF).unwrap();
    let arrays = [
        ("vertices", vertices),
        ("traces", paths.lines),
        ("particles", paths.dots),
        ("phase_lower", paths.phases[0].clone()),
        ("phase_upper", paths.phases[1].clone()),
    ];
    if binary {
        body.push('}');
        while body.len() % 4 != 0 { body.push(' '); }
        let capacity = 4 + body.len() + arrays.iter().map(|(_, a)| 4 + 4 * a.len()).sum::<usize>();
        let mut bytes = Vec::with_capacity(capacity);
        bytes.extend_from_slice(&(body.len() as u32).to_le_bytes());
        bytes.extend_from_slice(body.as_bytes());
        for (_, values) in arrays {
            bytes.extend_from_slice(&(values.len() as u32).to_le_bytes());
            for v in values { bytes.extend_from_slice(&v.to_le_bytes()); }
        }
        return bytes;
    }
    for (name, values) in arrays {
        write!(&mut body, ",\"{name}\":[").unwrap();
        for (i, v) in values.iter().enumerate() {
            if i > 0 {
                body.push(',');
            }
            write!(&mut body, "{v:.6e}").unwrap();
        }
        body.push(']');
    }
    body.push('}');
    body.into_bytes()
}
