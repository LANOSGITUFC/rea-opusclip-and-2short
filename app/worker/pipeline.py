#!/usr/bin/env python3
"""
Opus2Short AI Studio — Real Media & AI Processing Worker
Handles:
  1. ingest_youtube  - yt-dlp download + ffprobe + audio extract + thumbnail
  2. ingest_upload   - ffprobe + audio extract + thumbnail
  3. transcribe      - faster-whisper word-level timestamps (or API fallback)
  4. detect_faces    - OpenCV face detection -> normalized 9:16 crop keyframes
  5. render_clip     - Full FFmpeg render with .ass karaoke subtitles, 9:16/4:5/1:1/16:9,
                       Auto/Fill/Fit/Split/Three/Four layouts, transitions, motion zoom,
                       autoColor (denoise/sharpen/eq), watermark logo, text & progress bar.
"""

import sys
import os
import json
import subprocess
import math
import urllib.request
from pathlib import Path


def run_cmd(cmd, check=True):
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stderr[-1000:]}")
    return proc


def ffprobe_info(video_path):
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(video_path)
    ]
    proc = run_cmd(cmd)
    data = json.loads(proc.stdout)
    duration = float(data.get("format", {}).get("duration", 0))
    width, height, fps = 1280, 720, 30.0
    for s in data.get("streams", []):
        if s.get("codec_type") == "video":
            width = int(s.get("width", 1280))
            height = int(s.get("height", 720))
            r_fps = s.get("r_frame_rate", "30/1")
            if "/" in r_fps:
                num, den = r_fps.split("/")
                if float(den) > 0:
                    fps = round(float(num) / float(den), 2)
            break
    return {"duration": duration, "width": width, "height": height, "fps": fps}


def extract_audio_and_thumb(video_path, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_path = out_dir / "audio.wav"
    thumb_path = out_dir / "thumb.jpg"

    run_cmd([
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(audio_path)
    ])

    run_cmd([
        "ffmpeg", "-y", "-i", str(video_path),
        "-ss", "00:00:01.000", "-vframes", "1", "-vf", "scale=640:-1",
        str(thumb_path)
    ], check=False)

    return str(audio_path), str(thumb_path) if thumb_path.exists() else None


def cmd_ingest_youtube(args):
    url = args["url"]
    out_dir = Path(args["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    video_path = out_dir / "source.mp4"

    # Fetch metadata first
    meta_proc = run_cmd([
        "yt-dlp", "--dump-json", "--no-playlist", "--no-warnings", url
    ])
    meta = json.loads(meta_proc.stdout.splitlines()[0])
    title = meta.get("title", "YouTube Video")
    channel = meta.get("uploader", meta.get("channel", "YouTube"))

    # Download mp4 (max 720p for fast CPU processing on 2 vCPU VM, fallback best)
    run_cmd([
        "yt-dlp", "--no-playlist", "--no-warnings",
        "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", str(video_path),
        url
    ])

    info = ffprobe_info(video_path)
    audio_path, thumb_path = extract_audio_and_thumb(video_path, out_dir)
    return {
        "title": title,
        "channel": channel,
        "videoPath": str(video_path),
        "audioPath": audio_path,
        "thumbPath": thumb_path,
        **info
    }


def cmd_ingest_upload(args):
    video_path = Path(args["video_path"])
    out_dir = Path(args["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    info = ffprobe_info(video_path)
    audio_path, thumb_path = extract_audio_and_thumb(video_path, out_dir)
    return {
        "videoPath": str(video_path),
        "audioPath": audio_path,
        "thumbPath": thumb_path,
        **info
    }


def cmd_transcribe(args):
    audio_path = args["audio_path"]
    model_size = args.get("model_size", "tiny")
    language = args.get("language") or None

    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments_gen, info = model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400)
    )

    segments = []
    words = []
    full_text_parts = []

    for seg in segments_gen:
        seg_words = []
        if seg.words:
            for w in seg.words:
                txt = w.word.strip()
                if not txt:
                    continue
                word_obj = {
                    "text": txt,
                    "start": round(float(w.start), 3),
                    "end": round(float(w.end), 3),
                    "prob": round(float(w.probability), 3)
                }
                seg_words.append(word_obj)
                words.append(word_obj)
        text_clean = seg.text.strip()
        if text_clean:
            full_text_parts.append(text_clean)
            segments.append({
                "id": seg.id,
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": text_clean,
                "words": seg_words
            })

    return {
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 3),
        "text": " ".join(full_text_parts),
        "segments": segments,
        "words": words
    }


def cmd_detect_faces(args):
    video_path = args["video_path"]
    sample_interval = float(args.get("interval_sec", 2.0))

    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"keyframes": [{"t": 0.0, "xPct": 0.5, "yPct": 0.5, "faces": 0}], "facecamBox": None}

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280
    h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720

    c_default = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    c_alt2 = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

    step = max(1, int(fps * sample_interval))
    keyframes = []
    detected_boxes = []
    frame_idx = 0
    last_x, last_y = 0.5, 0.42

    while frame_idx < total_frames and len(keyframes) < 120:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            break
        gray = clahe.apply(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        faces = c_alt2.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=3, minSize=(24, 24))
        if len(faces) == 0:
            faces = c_default.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=3, minSize=(24, 24))
        t_sec = round(frame_idx / fps, 2)
        if len(faces) > 0:
            fx, fy, fw, fh = max(faces, key=lambda b: b[2] * b[3])
            cx = (fx + fw / 2.0) / w
            cy = (fy + fh / 2.0) / h
            last_x = round(0.7 * cx + 0.3 * last_x, 4)
            last_y = round(0.7 * cy + 0.3 * last_y, 4)
            detected_boxes.append((cx, cy, fw / w, fh / h))
            keyframes.append({
                "t": t_sec,
                "xPct": last_x,
                "yPct": last_y,
                "wPct": round(fw / w, 4),
                "hPct": round(fh / h, 4),
                "faces": int(len(faces))
            })
        else:
            keyframes.append({"t": t_sec, "xPct": last_x, "yPct": last_y, "faces": 0})
        frame_idx += step

    cap.release()
    if not keyframes:
        keyframes = [{"t": 0.0, "xPct": 0.5, "yPct": 0.45, "faces": 0}]

    # Compute median facecam bounding box (expanded around face for shoulders/headset)
    facecam_box = None
    if detected_boxes:
        xs = sorted(b[0] for b in detected_boxes)
        ys = sorted(b[1] for b in detected_boxes)
        ws = sorted(b[2] for b in detected_boxes)
        hs = sorted(b[3] for b in detected_boxes)
        mid = len(detected_boxes) // 2
        mx, my, mw, mh = xs[mid], ys[mid], ws[mid], hs[mid]
        box_w = max(0.24, min(0.45, mw * 2.8))
        box_h = max(0.26, min(0.48, mh * 2.6))
        facecam_box = {
            "camX": round(max(0.0, min(1.0, mx)), 3),
            "camY": round(max(0.0, min(1.0, my)), 3),
            "camW": round(box_w, 3),
            "camH": round(box_h, 3)
        }

    return {"keyframes": keyframes, "facecamBox": facecam_box}


def hex_to_ass_color(hex_color, alpha=0):
    """Convert #RRGGBB to &HAABBGGRR for ASS subtitles."""
    h = (hex_color or "#FFFFFF").lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def format_ass_time(sec):
    sec = max(0.0, float(sec))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int(round((sec - int(sec)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


PRESET_STYLES = {
    "karaoke":         {"primary": "#FFFFFF", "highlight": "#04F827", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 3, "fontSize": 68, "upper": True, "wordsPerLine": 3},
    "think-media":     {"primary": "#FFFFFF", "highlight": "#FFE600", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 6, "shadow": 4, "fontSize": 70, "upper": True, "wordsPerLine": 3},
    "highlighter-box": {"primary": "#FFFFFF", "highlight": "#1C4EBF", "outline": "#1C4EBF", "back": "#1C4EBF", "borderStyle": 3, "outlinePx": 8, "shadow": 0, "fontSize": 64, "upper": True, "wordsPerLine": 4},
    "spotlight":       {"primary": "#FFFFFF", "highlight": "#FFD600", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 2, "fontSize": 66, "upper": True, "wordsPerLine": 3},
    "marker":          {"primary": "#FFFFFF", "highlight": "#00F5D4", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 2, "fontSize": 66, "upper": True, "wordsPerLine": 3},
    "one-beat":        {"primary": "#FFFFFF", "highlight": "#FF37B9", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 6, "shadow": 4, "fontSize": 84, "upper": True, "wordsPerLine": 1},
    "comic":           {"primary": "#FFE600", "highlight": "#FF0055", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 7, "shadow": 5, "fontSize": 72, "upper": True, "wordsPerLine": 3},
    "punch":           {"primary": "#FFFFFF", "highlight": "#FFE600", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 6, "shadow": 3, "fontSize": 74, "upper": True, "wordsPerLine": 2},
    "seamless-bounce": {"primary": "#FFFFFF", "highlight": "#D7FF37", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 3, "fontSize": 68, "upper": True, "wordsPerLine": 3},
    "glitch":          {"primary": "#FFFFFF", "highlight": "#5DFBFF", "outline": "#FF0055", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 4, "fontSize": 68, "upper": True, "wordsPerLine": 3},
    "sunset":          {"primary": "#FFFFFF", "highlight": "#FF37B9", "outline": "#2B0033", "back": "#000000", "borderStyle": 1, "outlinePx": 5, "shadow": 3, "fontSize": 68, "upper": True, "wordsPerLine": 3},
    "editorial":       {"primary": "#F8FAFC", "highlight": "#E2E8F0", "outline": "#0F172A", "back": "#0F172A", "borderStyle": 1, "outlinePx": 3, "shadow": 2, "fontSize": 56, "upper": False, "wordsPerLine": 5},
    "typewriter":      {"primary": "#38BDF8", "highlight": "#FFFFFF", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 4, "shadow": 2, "fontSize": 58, "upper": False, "wordsPerLine": 4},
    "classic":         {"primary": "#FFFFFF", "highlight": "#FFFFFF", "outline": "#000000", "back": "#000000", "borderStyle": 1, "outlinePx": 3, "shadow": 2, "fontSize": 54, "upper": False, "wordsPerLine": 6},
}


def build_ass_subtitles(words, start_sec, end_sec, preset_name, caption_cfg, out_w, out_h, ass_path):
    style = dict(PRESET_STYLES.get(preset_name, PRESET_STYLES["karaoke"]))
    if caption_cfg:
        if caption_cfg.get("highlightColor"):
            style["highlight"] = caption_cfg["highlightColor"]
        if caption_cfg.get("primaryColor"):
            style["primary"] = caption_cfg["primaryColor"]
        if caption_cfg.get("fontSize"):
            style["fontSize"] = int(caption_cfg["fontSize"])
        if "uppercase" in caption_cfg:
            style["upper"] = bool(caption_cfg["uppercase"])

    font_name = (caption_cfg or {}).get("fontFamily", "DejaVu Sans")
    pos_y_pct = float((caption_cfg or {}).get("positionY", 0.72))
    margin_v = int(out_h * (1.0 - pos_y_pct))

    primary_ass = hex_to_ass_color(style["primary"], 0)
    highlight_ass = hex_to_ass_color(style["highlight"], 0)
    outline_ass = hex_to_ass_color(style["outline"], 0)
    back_ass = hex_to_ass_color(style["back"], 120)

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {out_w}
PlayResY: {out_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{style['fontSize']},{primary_ass},{highlight_ass},{outline_ass},{back_ass},-1,0,0,0,100,100,0,0,{style['borderStyle']},{style['outlinePx']},{style['shadow']},2,40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    # Filter words inside clip window and shift relative to start_sec
    clip_words = []
    for w in (words or []):
        ws = float(w.get("start", 0))
        we = float(w.get("end", ws + 0.25))
        if we >= start_sec and ws <= end_sec:
            txt = str(w.get("text", "")).strip()
            if not txt:
                continue
            if style["upper"]:
                txt = txt.upper()
            # Escape ASS special chars
            txt = txt.replace("{", "").replace("}", "").replace("\\", "")
            clip_words.append({
                "text": txt,
                "start": max(0.0, ws - start_sec),
                "end": max(0.05, min(end_sec - start_sec, we - start_sec)),
                "emoji": w.get("emoji", "")
            })

    events = []
    wpl = style["wordsPerLine"]
    for i in range(0, len(clip_words), wpl):
        chunk = clip_words[i:i + wpl]
        if not chunk:
            continue
        # Word-by-word active highlight line for crisp karaoke effect
        for active_idx, active_w in enumerate(chunk):
            ev_start = active_w["start"]
            ev_end = chunk[active_idx + 1]["start"] if active_idx + 1 < len(chunk) else active_w["end"]
            if ev_end <= ev_start:
                ev_end = ev_start + 0.12
            parts = []
            for j, cw in enumerate(chunk):
                if j == active_idx:
                    parts.append(f"{{\\c{highlight_ass}\\fscx110\\fscy110}}{cw['text']}{{\\c{primary_ass}\\fscx100\\fscy100}}")
                else:
                    parts.append(cw["text"])
            line_text = " ".join(parts)
            events.append(f"Dialogue: 0,{format_ass_time(ev_start)},{format_ass_time(ev_end)},Default,,0,0,0,,{line_text}")

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header + "\n".join(events) + "\n")
    return str(ass_path)


def cmd_render_clip(args):
    video_path = args["video_path"]
    out_path = args["out_path"]
    start_sec = float(args.get("start_sec", 0))
    end_sec = float(args.get("end_sec", start_sec + 30))
    duration = max(1.0, end_sec - start_sec)

    aspect = args.get("aspect_ratio", "9:16")
    resolution = args.get("resolution", "1080p")
    fps = int(args.get("fps", 30))
    layout = args.get("layout_mode", "auto")
    framing = args.get("framing") or {}
    auto_color = args.get("auto_color") or {}
    caption_enabled = args.get("caption_enabled", True)
    caption_preset = args.get("caption_preset", "karaoke")
    caption_cfg = args.get("caption_config") or {}
    words = args.get("words") or []
    watermark_path = args.get("watermark_path")
    headline_text = args.get("headline_text", "")
    progress_bar = bool(args.get("progress_bar", False))

    # Target dimensions
    scale_base = 1080 if resolution == "1080p" else 720
    if aspect == "9:16":
        out_w, out_h = (scale_base, int(scale_base * 16 / 9))
    elif aspect == "4:5":
        out_w, out_h = (scale_base, int(scale_base * 5 / 4))
    elif aspect == "1:1":
        out_w, out_h = (scale_base, scale_base)
    else:  # 16:9
        out_w, out_h = (int(scale_base * 16 / 9), scale_base)
    # Ensure even dimensions for x264
    out_w -= out_w % 2
    out_h -= out_h % 2

    src_info = ffprobe_info(video_path)
    src_w, src_h = src_info["width"], src_info["height"]

    pan_x = float(framing.get("panX", 0.5))
    pan_y = float(framing.get("panY", 0.5))
    zoom = max(1.0, min(3.0, float(framing.get("zoom", 1.0))))

    filter_parts = []
    if layout == "fit":
        # Blurred background + centered original video
        filter_parts.append(
            f"[0:v]split=2[bg][fg];"
            f"[bg]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,crop={out_w}:{out_h},boxblur=24:4[bgb];"
            f"[fg]scale={out_w}:{out_h}:force_original_aspect_ratio=decrease[fgf];"
            f"[bgb][fgf]overlay=(W-w)/2:(H-h)/2[vbase]"
        )
    elif layout == "split":
        # Gaming split: Top facecam crop (40% height) centered on camX/camY + Bottom gameplay (60% height)
        top_h = int(out_h * 0.40)
        top_h -= top_h % 2
        bot_h = out_h - top_h
        cam_x_pct = float(framing.get("camX", pan_x if pan_x != 0.5 else 0.15))
        cam_y_pct = float(framing.get("camY", pan_y if pan_y != 0.45 else 0.80))
        cam_w_pct = max(0.15, min(0.65, float(framing.get("camW", 0.28))))
        cam_h_pct = max(0.15, min(0.65, float(framing.get("camH", 0.32))))

        cw = max(64, int(src_w * cam_w_pct))
        ch = max(64, int(src_h * cam_h_pct))
        cw -= cw % 2
        ch -= ch % 2
        cx = int(max(0, min(src_w - cw, src_w * cam_x_pct - cw / 2.0)))
        cy = int(max(0, min(src_h - ch, src_h * cam_y_pct - ch / 2.0)))

        filter_parts.append(
            f"[0:v]split=2[vtop][vbot];"
            f"[vtop]crop={cw}:{ch}:{cx}:{cy},scale={out_w}:{top_h}:force_original_aspect_ratio=increase,crop={out_w}:{top_h}[top];"
            f"[vbot]scale={out_w}:{bot_h}:force_original_aspect_ratio=increase,crop={out_w}:{bot_h}[bot];"
            f"[top][bot]vstack=inputs=2[vbase]"
        )
    else:
        # Auto / Fill / Three / Four — center crop precisely on speaker pan_x, pan_y
        target_ar = out_w / out_h
        src_ar = src_w / src_h
        if src_ar > target_ar:
            crop_h = int(src_h / zoom)
            crop_w = int(crop_h * target_ar)
        else:
            crop_w = int(src_w / zoom)
            crop_h = int(crop_w / target_ar)
        crop_w = max(64, min(src_w, crop_w - (crop_w % 2)))
        crop_h = max(64, min(src_h, crop_h - (crop_h % 2)))
        crop_x = int(max(0, min(src_w - crop_w, src_w * pan_x - crop_w / 2.0)))
        crop_y = int(max(0, min(src_h - crop_h, src_h * pan_y - crop_h / 2.0)))
        filter_parts.append(f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}[vbase]")

    current_v = "[vbase]"
    post_filters = []

    # AutoColor filters (sharpen / denoise / contrast)
    if auto_color.get("enabled"):
        if float(auto_color.get("denoise", 0)) > 0:
            post_filters.append("hqdn3d=2:2:4:4")
        if float(auto_color.get("sharpen", 0)) > 0:
            amt = min(1.5, float(auto_color.get("sharpen", 0.5)) * 1.2)
            post_filters.append(f"unsharp=5:5:{amt:.2f}:5:5:0.0")
        post_filters.append("eq=contrast=1.06:saturation=1.12")

    # Progress bar overlay (Social Edit workflow)
    if progress_bar:
        post_filters.append(f"drawbox=x=0:y=0:w='iw*(t/{duration:.3f})':h=12:color=#04F827@0.95:t=fill")

    # Headline overlay
    if headline_text:
        safe_hl = headline_text.replace("'", "").replace(":", " ").replace("\\", "")[:60]
        post_filters.append(
            f"drawtext=text='{safe_hl}':fontcolor=white:fontsize=46:box=1:boxcolor=black@0.72:boxborderw=18:x=(w-text_w)/2:y=90"
        )

    # ASS subtitles burn-in
    ass_file = None
    if caption_enabled and words:
        ass_file = str(Path(out_path).with_suffix(".ass"))
        build_ass_subtitles(words, start_sec, end_sec, caption_preset, caption_cfg, out_w, out_h, ass_file)
        escaped_ass = ass_file.replace("\\", "/").replace(":", "\\:")
        post_filters.append(f"ass='{escaped_ass}'")

    if post_filters:
        filter_parts.append(f"{current_v}{','.join(post_filters)}[vpost]")
        current_v = "[vpost]"

    inputs = ["-ss", f"{start_sec:.3f}", "-t", f"{duration:.3f}", "-i", str(video_path)]
    if watermark_path and os.path.exists(watermark_path):
        inputs += ["-i", str(watermark_path)]
        filter_parts.append(f"[1:v]scale=140:-1[wm];{current_v}[wm]overlay=W-w-30:30[vout]")
        current_v = "[vout]"

    filter_complex = ";".join(filter_parts)
    cmd = [
        "ffmpeg", "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", current_v, "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-r", str(fps), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_path)
    ]
    run_cmd(cmd)
    out_size = os.path.getsize(out_path)
    return {"exportPath": str(out_path), "sizeBytes": out_size, "width": out_w, "height": out_h, "fps": fps}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Missing command"}))
        sys.exit(1)

    cmd = sys.argv[1]
    payload = json.loads(sys.stdin.read() or "{}")

    handlers = {
        "ingest_youtube": cmd_ingest_youtube,
        "ingest_upload": cmd_ingest_upload,
        "transcribe": cmd_transcribe,
        "detect_faces": cmd_detect_faces,
        "render_clip": cmd_render_clip,
    }

    if cmd not in handlers:
        print(json.dumps({"ok": False, "error": f"Unknown command: {cmd}"}))
        sys.exit(1)

    try:
        result = handlers[cmd](payload)
        print(json.dumps({"ok": True, "data": result}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
