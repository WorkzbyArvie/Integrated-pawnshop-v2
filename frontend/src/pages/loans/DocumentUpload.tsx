import React, { useState, useCallback } from 'react';
import Swal from 'sweetalert2';
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { getBackendUrl } from '../../lib/backendUrl';

interface DocumentUploadProps {
  applicationId: string;
  onUploadSuccess: () => void;
  onClose: () => void;
}

const DOCUMENT_TYPES = [
  { value: 'VALID_ID', label: 'Valid ID' },
  { value: 'PROOF_OF_INCOME', label: 'Proof of Income' },
  { value: 'RESIDENCE_PROOF', label: 'Proof of Residence' },
  { value: 'BANK_STATEMENT', label: 'Bank Statement' },
  { value: 'ITR', label: 'Income Tax Return (ITR)' },
  { value: 'BARANGAY_CLEARANCE', label: 'Barangay Clearance' },
  { value: 'COLLATERAL_PHOTO', label: 'Collateral Photo' },
  { value: 'OTHER', label: 'Other Document' },
];

interface UploadingFile {
  file: File;
  documentType: string;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  error: string | null;
}

export function DocumentUpload({ applicationId, onUploadSuccess, onClose }: DocumentUploadProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter((file) => {
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
      const maxSize = 10 * 1024 * 1024; // 10MB

      if (!validTypes.includes(file.type)) {
        void Swal.fire({
          icon: 'error',
          title: 'Invalid file type',
          text: `${file.name} is not valid. Upload PDF or image files only.`,
        });
        return false;
      }

      if (file.size > maxSize) {
        void Swal.fire({
          icon: 'error',
          title: 'File too large',
          text: `${file.name} exceeds the 10MB size limit.`,
        });
        return false;
      }

      return true;
    });

    setSelectedFiles((prev) => [...prev, ...validFiles]);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...files]);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFile = async (file: File, documentType: string): Promise<void> => {
    const backendUrl = getBackendUrl();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('applicationId', applicationId);
    formData.append('documentType', documentType);

    const xhr = new XMLHttpRequest();

    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploadingFiles((prev) =>
            prev.map((uf) =>
              uf.file === file ? { ...uf, progress } : uf,
            ),
          );
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadingFiles((prev) =>
            prev.map((uf) =>
              uf.file === file ? { ...uf, status: 'success', progress: 100 } : uf,
            ),
          );
          resolve();
        } else {
          const error = xhr.responseText || 'Upload failed';
          setUploadingFiles((prev) =>
            prev.map((uf) =>
              uf.file === file ? { ...uf, status: 'error', error } : uf,
            ),
          );
          reject(new Error(error));
        }
      });

      xhr.addEventListener('error', () => {
        const error = 'Network error during upload';
        setUploadingFiles((prev) =>
          prev.map((uf) =>
            uf.file === file ? { ...uf, status: 'error', error } : uf,
          ),
        );
        reject(new Error(error));
      });

      xhr.open('POST', `${backendUrl}/loan/documents/upload`);
      xhr.send(formData);
    });
  };

  const handleUploadAll = async () => {
    if (selectedFiles.length === 0) return;

    // Initialize uploading files
    const initialUploadingFiles: UploadingFile[] = selectedFiles.map((file) => ({
      file,
      documentType: 'OTHER',
      progress: 0,
      status: 'uploading',
      error: null,
    }));
    setUploadingFiles(initialUploadingFiles);

    // Upload all files
    try {
      await Promise.all(
        selectedFiles.map((file, index) =>
          uploadFile(file, initialUploadingFiles[index].documentType),
        ),
      );

      // All uploads successful
      setTimeout(() => {
        onUploadSuccess();
        onClose();
      }, 1000);
    } catch (error) {
      console.error('âŒ Upload error:', error);
    }
  };

  const updateDocumentType = (index: number, documentType: string) => {
    setUploadingFiles((prev) =>
      prev.map((uf, i) =>
        i === index ? { ...uf, documentType } : uf,
      ),
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#14141B] rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-[rgba(201,160,92,0.1)] flex items-center justify-between">
          <h2 className="text-2xl font-black text-[#F5F0E8]">Upload Documents</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-6 h-6 text-[#B8B0A4]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Drag & Drop Area */}
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-12 text-center transition ${
              isDragging
                ? 'border-[#C9A05C] bg-[#C9A05C]/10'
                : 'border-[rgba(201,160,92,0.15)] hover:border-[rgba(201,160,92,0.4)]'
            }`}
          >
            <Upload
              className={`w-16 h-16 mx-auto mb-4 ${
                isDragging ? 'text-[#C9A05C]' : 'text-[#8A8279]'
              }`}
            />
            <p className="text-lg font-bold text-[#F5F0E8] mb-2">
              Drag & drop files here
            </p>
            <p className="text-[#B8B0A4] mb-4">
              or click the button below to select files
            </p>
            <label className="inline-block px-6 py-3 bg-[#C9A05C] text-white font-bold rounded-xl hover:bg-[#E5C88C] transition cursor-pointer">
              Select Files
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
            <p className="text-sm text-[#8A8279] mt-4">
              Supported formats: PDF, PNG, JPG (max 10MB per file)
            </p>
          </div>

          {/* Selected Files */}
          {selectedFiles.length > 0 && uploadingFiles.length === 0 && (
            <div className="space-y-3">
              <h3 className="font-bold text-[#F5F0E8]">Selected Files ({selectedFiles.length})</h3>
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-xl"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <FileText className="w-5 h-5 text-[#B8B0A4] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#F5F0E8] truncate">{file.name}</p>
                      <p className="text-sm text-[#8A8279]">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(index)}
                    className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition ml-2"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Uploading Files */}
          {uploadingFiles.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-bold text-[#F5F0E8]">Uploading Files</h3>
              {uploadingFiles.map((uploadFile, index) => (
                <div
                  key={index}
                  className="p-4 bg-gray-50 rounded-xl space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <FileText className="w-5 h-5 text-[#B8B0A4] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[#F5F0E8] truncate">
                          {uploadFile.file.name}
                        </p>
                        <p className="text-sm text-[#8A8279]">
                          {formatFileSize(uploadFile.file.size)}
                        </p>
                      </div>
                    </div>
                    {uploadFile.status === 'uploading' && (
                      <Loader2 className="w-5 h-5 text-[#C9A05C] animate-spin" />
                    )}
                    {uploadFile.status === 'success' && (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    )}
                    {uploadFile.status === 'error' && (
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    )}
                  </div>

                  {/* Document Type Selector */}
                  {uploadFile.status !== 'success' && (
                    <select
                      value={uploadFile.documentType}
                      onChange={(e) => updateDocumentType(index, e.target.value)}
                      className="w-full px-4 py-2 border border-[rgba(201,160,92,0.15)] rounded-lg focus:border-[#C9A05C] focus:ring-2 focus:ring-[rgba(201,160,92,0.2)] outline-none"
                      disabled={uploadFile.status !== 'uploading'}
                    >
                      {DOCUMENT_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Progress Bar */}
                  {uploadFile.status === 'uploading' && (
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-[#C9A05C] h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadFile.progress}%` }}
                      ></div>
                    </div>
                  )}

                  {/* Error Message */}
                  {uploadFile.status === 'error' && uploadFile.error && (
                    <p className="text-sm text-red-600">{uploadFile.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[rgba(201,160,92,0.1)] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-100 text-[#B8B0A4] font-bold rounded-xl hover:bg-gray-200 transition"
            disabled={uploadingFiles.some((uf) => uf.status === 'uploading')}
          >
            Cancel
          </button>
          <button
            onClick={handleUploadAll}
            disabled={selectedFiles.length === 0 || uploadingFiles.length > 0}
            className="px-6 py-3 bg-[#C9A05C] text-white font-bold rounded-xl hover:bg-[#E5C88C] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Upload {selectedFiles.length > 0 && `(${selectedFiles.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
