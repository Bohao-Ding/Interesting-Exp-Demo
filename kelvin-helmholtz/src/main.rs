use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    thread,
};

fn serve(mut stream: TcpStream) -> std::io::Result<()> {
    let mut request = Vec::new();
    let header_end = loop {
        let mut chunk = [0; 8192];
        let count = stream.read(&mut chunk)?;
        if count == 0 {
            return Ok(());
        }
        request.extend_from_slice(&chunk[..count]);
        if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
            break end + 4;
        }
        if request.len() > 16384 {
            return Ok(());
        }
    };
    let header = String::from_utf8_lossy(&request[..header_end]);
    let method = header.split_whitespace().next().unwrap_or("GET");
    let path = header
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/");
    if method == "POST" && matches!(path, "/save/preview.png" | "/save/validation.json") {
        let length = header
            .lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, value)| value.trim().parse::<usize>().ok())
            .unwrap_or(0);
        if length == 0 || length > 64 * 1024 * 1024 {
            return Ok(());
        }
        let mut body = vec![0; length];
        let copied = (request.len() - header_end).min(length);
        body[..copied].copy_from_slice(&request[header_end..header_end + copied]);
        stream.read_exact(&mut body[copied..])?;
        let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("output");
        std::fs::create_dir_all(&output)?;
        std::fs::write(output.join(path.trim_start_matches("/save/")), body)?;
        stream.write_all(
            b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        return Ok(());
    }
    let file = match path {
        "/" | "/index.html" => "index.html",
        "/app.js" => "app.js",
        "/verification.js" => "verification.js",
        "/simulation.wgsl" => "simulation.wgsl",
        "/render.wgsl" => "render.wgsl",
        "/remesh.wgsl" => "remesh.wgsl",
        "/flow.js" => "flow.js",
        "/output/preview.png" => "output/preview.png",
        "/output/validation.json" => "output/validation.json",
        _ => {
            stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )?;
            return Ok(());
        }
    };
    let body = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join(file))?;
    let mime = if file.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if file.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if file.ends_with(".png") {
        "image/png"
    } else if file.ends_with(".json") {
        "application/json; charset=utf-8"
    } else {
        "text/plain; charset=utf-8"
    };
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)
}

fn main() -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:8767")?;
    println!(
        "Kelvin-Helmholtz shear instability — http://127.0.0.1:8767\nGPU CFD runs in the browser. Ctrl+C stops this local server."
    );
    for stream in listener.incoming() {
        let stream = stream?;
        thread::spawn(move || {
            if let Err(error) = serve(stream) {
                eprintln!("Request: {error}");
            }
        });
    }
    Ok(())
}
