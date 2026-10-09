# I-Observe

Local face-recognition and video-observation demo. The active face path is:

`YOLO11 Face (bbox + five landmarks) → affine alignment → MiniFASNetV2 → ArcFace 512-D ONNX → TurboVec → identity`

The FastAPI UI, live camera API, enrollment API, video analyzer, and Colab notebook use the same model family. Enrollment stores one ArcFace template per accepted image, and each detected face is processed independently. PostgreSQL remains the event timeline; Qdrant is not used by the active face-index path.

## Start the project on Windows

```powershell
git clone https://github.com/mennademrdash/i-observe.git
cd i-observe
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\scripts\setup_models.ps1
Copy-Item .env.example .env
# Edit .env and replace the example PostgreSQL password in both matching values.
.\start_iobserve.ps1
```

Open `http://localhost:8000`. Core AI weights are published as checksum-verified
[GitHub Release assets](https://github.com/mennademrdash/i-observe/releases/tag/models-v1),
then installed by `scripts/setup_models.ps1`. VideoMAE is fetched from Hugging Face on its
first video-analysis run. Enrollment vectors, face photos, events, evidence, credentials and
API keys are runtime data and are intentionally created locally.

To enroll a person, open **Enroll Person** in the web UI, enter a name, and upload clear images containing exactly one face each. The local camera viewer is optional:

```powershell
.\.venv\Scripts\python.exe app.py
```

It opens the camera first, then runs the same YOLO11/MiniFASNet/ArcFace/TurboVec inference path. Press `q` or `Esc` to exit; enrollment remains in the web UI.

## Chat assistant (`web/`)

The chat is **embedded in the dashboard itself** — an "ASSISTANT" button sits at the bottom
right of every page and opens a panel with the full agent. `start_iobserve.ps1` starts it
automatically (and `stop_iobserve.ps1` stops it); if it is not running the button says
`NOT RUNNING` with a retry, so the dashboard keeps working either way.

The Python service is untouched and stays the single system of record. Calls to it happen
server-side from the assistant app, which is a small Next.js + assistant-ui front-end:

```powershell
cd E:\I-observe\web
npm install       # first time only
npm run dev       # http://localhost:3100  (or: npm run build && npm start)
```

Requires `API_TOKEN` in `.env` once a user account exists (the API then demands a login); see
`web/README.md` for that and the rest of the configuration.

## Colab notebook

Open `face_recognition_pipeline_colab.ipynb` in Google Colab. Upload these existing project weights when prompted:

- `models/yolo11n-pose_widerface.pt`
- `models/auraface_glintr100.onnx`
- `models/minifasnet_v2.onnx`

Colab runs in an isolated runtime: its TurboVec index, events, and media do not connect to this Windows app unless separately shared/mounted. The notebook is a portable inference demo, not a remote app backend.

## Model and security limitations

- `ARCFACE_MATCH_THRESHOLD` is configurable; the current `0.25` value is a preliminary fit to six MENNA enrollment photos and ten sampled LFW images, not a validated security threshold.
- The active 512-D weight is `fal/AuraFace-v1` (Apache-2.0 model card); its SHA-256 is pinned in `models.manifest.json`.
- MiniFASNetV2 currently produces a false-live result for at least one still enrollment photo in local API testing. Do not use this anti-spoof path as an access-control security gate until it passes a representative live/spoof benchmark.
