# Interesting Exp Demo

有趣的科学与计算实验动画。每个实验使用独立子目录，并在自己的 README 中说明依赖、启动、关闭和计算范围。

## 实验目录

| 目录 | 实验 | 启动说明 |
|---|---|---|
| `navier-stokes` | Navier–Stokes 爆破解演示动画：局部自相似涡核、旋转层与上下排出通道 | [README](navier-stokes/README.md) |
| `karman-vortex` | 自编 GPU CFD 卡门涡街：圆柱绕流、流速/涡量/流向、缩放与自动网格加密 | [README](karman-vortex/README.md) |

新增实验时在仓库根目录建立独立子目录，并更新此索引。

## 获取与运行

```powershell
git clone https://github.com/Bohao-Ding/Interesting-Exp-Demo.git
cd Interesting-Exp-Demo
cargo run --release --manifest-path karman-vortex/Cargo.toml
```

以上命令启动卡门涡街实验，随后打开 `http://127.0.0.1:8766`。安装依赖、操作和关闭方式见各实验 README；克隆仓库本身不会启动计算。
