import {useCallback} from 'react'
import {type FileRejection, useDropzone} from "react-dropzone";
import {formatSize} from "~/lib/util";

interface FileUploaderProps {
    file: File | null;
    onFileSelect?: (file: File | null) => void;
}

const maxFileSize = 20 * 1024 * 1024;

const FileUploader = ({ file, onFileSelect }: FileUploaderProps) => {
    const onDrop = useCallback((acceptedFiles: File[]) => {
        onFileSelect?.(acceptedFiles[0] || null);
    }, [onFileSelect]);

    const {getRootProps, getInputProps, fileRejections} = useDropzone({
        onDrop,
        multiple: false,
        accept: {'application/pdf': ['.pdf']},
        maxSize: maxFileSize,
    })

    const rejection: FileRejection | undefined = fileRejections[0];

    return (
        <div className="w-full gradient-border">
            <div {...getRootProps()}>
                <input id="uploader" {...getInputProps()} />
                <div className="space-y-4 cursor-pointer">

                    {file ? (
                        <div className="uploader-selected-file" onClick={(e) => e.stopPropagation()}>
                            <img src="/images/pdf.png" alt="pdf" className="size-10" />
                            <div className="flex items-center space-x-3">
                                <div>
                                    <p className="text-sm font-medium text-gray-700 truncate max-w-xs">
                                        {file.name}
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        {formatSize(file.size)}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                aria-label="Remove file"
                                className="p-2 cursor-pointer"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onFileSelect?.(null);
                                }}
                            >
                                <img src="/icons/cross.svg" alt="" className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <div>
                            <div className="mx-auto w-16 h-16 flex items-center justify-center mb-2">
                                <img src="/icons/info.svg" alt="upload Resume" className="size-20"/>
                            </div>
                            <p className="text-lg text-gray-500">
                                <span className="font-semibold">
                                   Click to Upload
                                </span> or Drag and Drop
                            </p>
                            <p className="text-lg text-gray-500">PDF (max {formatSize(maxFileSize)})</p>
                        </div>
                    )}
                    {!file && rejection && (
                        <p role="alert" className="text-sm text-red-600">
                            {rejection.errors[0]?.code === 'file-too-large'
                                ? `File is too large. Maximum size is ${formatSize(maxFileSize)}.`
                                : 'Only PDF files are supported.'}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}
export default FileUploader
