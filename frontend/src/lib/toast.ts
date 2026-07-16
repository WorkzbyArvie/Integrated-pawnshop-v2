import Swal from 'sweetalert2';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  duration?: number;
  position?: 'top' | 'bottom';
}

const fireToast = (message: string, type: ToastType, options?: ToastOptions) => {
  const duration = options?.duration ?? 4000;
  const position = options?.position === 'bottom' ? 'bottom' : 'top';

  void Swal.fire({
    toast: true,
    position,
    icon: type,
    title: message,
    showConfirmButton: false,
    timer: duration,
    timerProgressBar: true,
  });
};

export const toast = {
  success: (message: string, options?: ToastOptions) => fireToast(message, 'success', options),
  error: (message: string, options?: ToastOptions) => fireToast(message, 'error', options),
  warning: (message: string, options?: ToastOptions) => fireToast(message, 'warning', options),
  info: (message: string, options?: ToastOptions) => fireToast(message, 'info', options),
};
