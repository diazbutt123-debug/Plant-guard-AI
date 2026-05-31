from flask import Flask, request, jsonify
from flask_cors import CORS
import tensorflow as tf
import numpy as np
import json
import base64
import io
from PIL import Image

app = Flask(__name__)
CORS(app)

print("Loading model...")
model = tf.keras.models.load_model("plantguard_model.h5")

with open("class_labels.json", "r", encoding="utf-8") as f:
    labels = json.load(f)

print(f"Model loaded! {len(labels)} classes ready.")
print("Server running at http://localhost:5000")


@app.route("/predict", methods=["POST"])
def predict():
    try:
        data    = request.json["image"]
        imgdata = base64.b64decode(data)
        img     = Image.open(io.BytesIO(imgdata)).resize((128, 128)).convert("RGB")
        arr     = np.array(img, dtype=np.float32) / 255.0
        arr     = np.expand_dims(arr, axis=0)
        preds   = model.predict(arr, verbose=0)
        idx     = np.argsort(preds[0])[::-1]
        top3    = [{"label": labels[i], "confidence": round(float(preds[0][i]) * 100, 2)} for i in idx[:3]]
        return jsonify({"success": True, "disease": top3[0]["label"], "confidence": top3[0]["confidence"], "top3": top3})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "classes": len(labels)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
