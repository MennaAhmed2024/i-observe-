from __future__ import annotations
import config  # noqa: F401  # sets BLAS thread caps before numpy/OpenCV load
import argparse, json, shutil, subprocess
from pathlib import Path
import cv2
from vision_core import YOLO11FaceDetector, MiniFASNet, OnnxEmbedder512, TurboVecFaceIndex, expanded_crop


class FaceTracker:
    """Small IoU tracker for stable face IDs in an annotated offline video."""
    def __init__(self, max_missed=2, min_iou=0.12):
        self.tracks = {}
        self.next_id = 1
        self.max_missed = max_missed
        self.min_iou = min_iou

    @staticmethod
    def _iou(a, b):
        x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
        inter = max(0, x2 - x1) * max(0, y2 - y1)
        union = max(1, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)
        return inter / union

    def update(self, detections):
        unmatched = set(self.tracks)
        assigned = []
        for det in detections:
            best = max(unmatched, key=lambda tid: self._iou(self.tracks[tid]["bbox"], det["bbox"]), default=None)
            score = self._iou(self.tracks[best]["bbox"], det["bbox"]) if best is not None else 0.0
            if best is None or score < self.min_iou:
                best = self.next_id
                self.next_id += 1
                self.tracks[best] = {"bbox": det["bbox"], "missed": 0, "identity": None, "score": 0.0}
            else:
                unmatched.remove(best)
            track = self.tracks[best]
            stable_identity, stable_score = track.get("identity"), track.get("score", 0.0)
            track.update(det)
            track.update({"bbox": det["bbox"], "missed": 0, "_observed": True})
            if det["identity"] not in ("unknown", "no_face", "alignment_error", "spoof_rejected") and det["similarity"] >= stable_score:
                track.update({"identity": det["identity"], "score": det["similarity"]})
            elif det["identity"] == "unknown" and stable_identity:
                track.update({"identity": stable_identity, "similarity": stable_score, "score": stable_score})
            assigned.append(dict(track, track_id=best))
        for tid in unmatched:
            self.tracks[tid]["missed"] += 1
            self.tracks[tid]["_observed"] = False
        self.tracks = {tid: t for tid, t in self.tracks.items() if t["missed"] <= self.max_missed}
        stale = [dict(t, track_id=tid) for tid, t in self.tracks.items() if tid in unmatched]
        return assigned + stale

def run(source, output, sample_every=3, stack=None):
    import config
    if stack is None:
        detector=YOLO11FaceDetector(str(config.YOLO_FACE_MODEL)); live_model=MiniFASNet(str(config.LIVENESS_PATH))
        embedder=OnnxEmbedder512(str(config.embedder_path()))
        if embedder.dim != 512: raise RuntimeError(f'Active ArcFace model must output 512-D, got {embedder.dim}')
        index=TurboVecFaceIndex(path=config.TURBOVEC_PATH, dim=embedder.dim)
    else:
        detector, embedder, live_model, index = stack
    cap=cv2.VideoCapture(source); fps=cap.get(cv2.CAP_PROP_FPS) or 25
    w,h=int(cap.get(3)),int(cap.get(4)); Path(output).parent.mkdir(parents=True,exist_ok=True)
    writer=cv2.VideoWriter(output,cv2.VideoWriter_fourcc(*'mp4v'),fps,(w,h))
    frame_no=0; events=[]; last=[]; tracker=FaceTracker(max_missed=2)
    while True:
        ok,frame=cap.read()
        if not ok: break
        if frame_no%sample_every==0:
            detected=[]
            for face in detector.detect(frame):
                is_live,live_score=live_model.predict(expanded_crop(frame,face.bbox))
                identity={'identity':'spoof_rejected','score':0.0}
                if is_live:
                    try: identity=index.identify(embedder.embed(embedder.align(frame,face)))
                    except Exception as exc: identity={'identity':'alignment_error','score':0.0}
                x1,y1,x2,y2=map(int,face.bbox); item={'frame':frame_no,'time':frame_no/fps,'bbox':[x1,y1,x2,y2],'identity':identity['identity'],'similarity':identity['score'],'live':is_live,'liveness_score':live_score,'landmarks':face.landmarks.tolist()}
                detected.append(item)
            last=tracker.update(detected)
            events.extend(item for item in last if item.get("_observed"))
        for item in last:
            x1,y1,x2,y2=item['bbox']
            label=item['identity']
            if not item['live']:
                color=(0,0,255)
            elif label in ('unknown','no_face','alignment_error','spoof_rejected'):
                color=(0,180,255)
            else:
                color=(0,220,0)
            cv2.rectangle(frame,(x1,y1),(x2,y2),color,2)
            for lx,ly in item.get('landmarks',[]): cv2.circle(frame,(int(lx),int(ly)),2,color,-1)
            text=f"#{item['track_id']} {label} sim={item['similarity']:.2f} live={item['liveness_score']:.2f}"
            cv2.putText(frame,text,(x1,max(25,y1-8)),cv2.FONT_HERSHEY_SIMPLEX,.55,color,2)
        writer.write(frame); frame_no+=1
    cap.release(); writer.release()
    # OpenCV's mp4v stream is not decoded by every Chromium build (it appears as
    # a black 0:00 player). Remux/transcode to browser-safe H.264 and restore the
    # source audio when ffmpeg is available.
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        final_path = Path(output)
        browser_path = final_path.with_name(final_path.stem + ".browser.mp4")
        converted = subprocess.run(
            [ffmpeg, "-y", "-i", str(final_path), "-i", str(source),
             "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "libx264",
             "-preset", "veryfast", "-crf", "23", "-c:a", "aac",
             "-movflags", "+faststart", "-shortest", str(browser_path)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if converted.returncode == 0 and browser_path.exists():
            browser_path.replace(final_path)
    identified=[e for e in events if e['identity'] not in ('unknown','no_face','alignment_error','spoof_rejected')]
    summary={'source':str(source),'output':str(Path(output).resolve()),'frames':frame_no,'detections':len(events),
             'tracks':tracker.next_id-1,
             'identified_faces':len(identified),
             'identities':sorted({e['identity'] for e in identified}),
             'live':sum(e['live'] for e in events),'spoof_rejected':sum(not e['live'] for e in events),
             'max_similarity':max((e['similarity'] for e in events),default=0),'events':events}
    Path(output).with_suffix('.json').write_text(json.dumps(summary,indent=2),encoding='utf-8'); return summary

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('source'); p.add_argument('--output',default='outputs/annotated.mp4'); a=p.parse_args()
    result=run(a.source,a.output); print(json.dumps({k:v for k,v in result.items() if k!='events'},indent=2))
