import * as faceapi from 'face-api.js';

let modelsLoaded = false;

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;

  const MODEL_URL = '/models';

  const models = [
    { name: 'ssdMobilenetv1', loader: () => faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL) },
    { name: 'faceLandmark68Net', loader: () => faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL) },
    { name: 'faceRecognitionNet', loader: () => faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL) },
  ];

  for (const model of models) {
    try {
      await model.loader();
    } catch (err: any) {
      console.error(`[faceMatch] Failed to load model "${model.name}" from ${MODEL_URL}:`, err.message || err);
      throw new Error(`Failed to load face model "${model.name}": ${err.message || 'unknown error'}`);
    }
  }

  modelsLoaded = true;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export interface FaceMatchResult {
  matched: boolean;
  similarity: number;
  idFaceDetected: boolean;
  selfieFaceDetected: boolean;
  idDetectionConfidence: number;
  selfieDetectionConfidence: number;
  error?: string;
}

const FACE_MATCH_THRESHOLD = 0.65;
const ID_DETECT_MIN_CONFIDENCE = 0.5;
const SELFIE_DETECT_MIN_CONFIDENCE = 0.5;

export async function compareFaces(
  idImageFile: File,
  selfieDataUrl: string,
): Promise<FaceMatchResult> {
  try {
    await loadFaceModels();

    const idImg = await fileToImage(idImageFile);
    const idDetections = await faceapi
      .detectSingleFace(idImg, new faceapi.SsdMobilenetv1Options({ minConfidence: ID_DETECT_MIN_CONFIDENCE }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!idDetections) {
      return {
        matched: false,
        similarity: 0,
        idFaceDetected: false,
        selfieFaceDetected: false,
        idDetectionConfidence: 0,
        selfieDetectionConfidence: 0,
        error: 'No clear face detected on the ID photo. Please upload a clearer ID image.',
      };
    }

    const idConfidence = idDetections.detection.score;

    const selfieImg = new Image();
    await new Promise<void>((resolve, reject) => {
      selfieImg.onload = () => resolve();
      selfieImg.onerror = reject;
      selfieImg.src = selfieDataUrl;
    });

    const selfieDetections = await faceapi
      .detectSingleFace(selfieImg, new faceapi.SsdMobilenetv1Options({ minConfidence: SELFIE_DETECT_MIN_CONFIDENCE }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!selfieDetections) {
      return {
        matched: false,
        similarity: 0,
        idFaceDetected: true,
        selfieFaceDetected: false,
        idDetectionConfidence: idConfidence,
        selfieDetectionConfidence: 0,
        error: 'No face detected in your selfie. Please retake with your face clearly visible.',
      };
    }

    const selfieConfidence = selfieDetections.detection.score;

    if (idConfidence < 0.6) {
      return {
        matched: false,
        similarity: 0,
        idFaceDetected: true,
        selfieFaceDetected: true,
        idDetectionConfidence: idConfidence,
        selfieDetectionConfidence: selfieConfidence,
        error: 'ID photo face detection confidence too low — image may be a drawing or low quality. Admin will review.',
      };
    }

    const similarity = cosineSimilarity(
      idDetections.descriptor,
      selfieDetections.descriptor,
    );

    return {
      matched: similarity >= FACE_MATCH_THRESHOLD,
      similarity,
      idFaceDetected: true,
      selfieFaceDetected: true,
      idDetectionConfidence: idConfidence,
      selfieDetectionConfidence: selfieConfidence,
    };
  } catch (err: any) {
    console.error('[faceMatch] compareFaces failed:', err.message || err);
    return {
      matched: false,
      similarity: 0,
      idFaceDetected: false,
      selfieFaceDetected: false,
      idDetectionConfidence: 0,
      selfieDetectionConfidence: 0,
      error: err.message || 'Face comparison failed',
    };
  }
}
