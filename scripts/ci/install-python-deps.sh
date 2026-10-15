#!/usr/bin/env bash
# Install CPU-only torch/torchvision from the PyTorch CPU wheel index (no CUDA download, roughly 200 MB instead of
# several GB), then everything in requirements.txt from PyPI. requirements.txt keeps plain `torch>=2.1`, which the
# already-installed CPU build satisfies, so local installs are unaffected.
set -euo pipefail
python -m pip install --upgrade pip
python -m pip install torch torchvision --index-url "${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}"
python -m pip install -r requirements.txt
python -c "import torch, torchvision, onnxruntime, flask; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
