use std::{io::{Read, Write}, net::{TcpListener, TcpStream}, path::Path, thread};

fn serve(mut stream: TcpStream) -> std::io::Result<()> {
    let mut request = Vec::new();
    let end = loop {
        let mut chunk = [0; 8192];
        let n = stream.read(&mut chunk)?;
        if n == 0 { return Ok(()); }
        request.extend_from_slice(&chunk[..n]);
        if let Some(i) = request.windows(4).position(|w| w == b"\r\n\r\n") { break i + 4; }
        if request.len() > 16384 { return Ok(()); }
    };
    let header = String::from_utf8_lossy(&request[..end]);
    let mut words = header.split_whitespace();
    let method = words.next().unwrap_or("GET");
    let path = words.next().unwrap_or("/").split('?').next().unwrap_or("/");
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    if method == "POST" && matches!(path, "/save/preview.png" | "/save/validation.json" | "/save/performance.json") {
        let n = header.lines().filter_map(|s| s.split_once(':'))
            .find(|(k,_)| k.eq_ignore_ascii_case("content-length"))
            .and_then(|(_,v)| v.trim().parse::<usize>().ok()).unwrap_or(0);
        if n == 0 || n > 64 * 1024 * 1024 { return Ok(()); }
        let mut body = vec![0; n];
        let copied = (request.len()-end).min(n);
        body[..copied].copy_from_slice(&request[end..end+copied]);
        stream.read_exact(&mut body[copied..])?;
        std::fs::create_dir_all(root.join("output"))?;
        std::fs::write(root.join("output").join(path.trim_start_matches("/save/")), body)?;
        stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    }
    let file = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    let allowed = matches!(file, "index.html" | "app.js" | "flow.js" | "render.js" |
        "simulation.wgsl" | "render.wgsl" | "trace.wgsl" | "data/geometry.json" | "data/mesh.bin")
        || (file.starts_with("data/grid-") && file.ends_with(".bin.gz") && !file.contains(".."));
    if !allowed || !root.join(file).is_file() {
        stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    }
    let body = std::fs::read(root.join(file))?;
    let mime = if file.ends_with(".html") { "text/html; charset=utf-8" }
        else if file.ends_with(".js") { "text/javascript; charset=utf-8" }
        else if file.ends_with(".json") { "application/json" } else { "application/octet-stream" };
    write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len())?;
    stream.write_all(&body)
}

fn main() -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:8768")?;
    println!("Wingtip vortex CFD — http://127.0.0.1:8768\nClose browser tab to release GPU. Ctrl+C stops server.");
    for stream in listener.incoming() {
        let stream = stream?;
        thread::spawn(move || { if let Err(e) = serve(stream) { eprintln!("Request: {e}"); } });
    }
    Ok(())
}
