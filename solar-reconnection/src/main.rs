use std::{io::{Read, Write}, net::TcpListener, path::Path, thread};

fn main() -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:8770")?;
    println!("Solar reconnection: http://127.0.0.1:8770\nClose the browser page to release WebGPU; Ctrl+C stops the server.");
    for stream in listener.incoming() {
        let mut stream = stream?;
        thread::spawn(move || -> std::io::Result<()> {
            let mut request = [0; 4096];
            let n = stream.read(&mut request)?;
            let request = String::from_utf8_lossy(&request[..n]);
            let file = match request.split_whitespace().nth(1).unwrap_or("/").split('?').next().unwrap_or("/") {
                "/" => "index.html",
                "/app.js" => "app.js",
                "/solver.js" => "solver.js",
                "/view.js" => "view.js",
                "/verify.js" => "verify.js",
                "/performance.js" => "performance.js",
                "/mhd.wgsl" => "mhd.wgsl",
                "/render.wgsl" => "render.wgsl",
                _ => { stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?; return Ok(()); }
            };
            let body = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join(file))?;
            let mime = if file.ends_with(".html") { "text/html; charset=utf-8" } else if file.ends_with(".js") { "text/javascript; charset=utf-8" } else { "text/plain; charset=utf-8" };
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len())?;
            stream.write_all(&body)
        });
    }
    Ok(())
}
