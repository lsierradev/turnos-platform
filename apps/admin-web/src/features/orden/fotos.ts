/**
 * Fotos de la recepcion (Sprint 22). Se achican en el navegador antes de
 * subirlas: la foto de un celular pesa 3-8 MB y la API acepta hasta 2 MB
 * por foto. 1600 px de lado alcanza para ver un rayon.
 */
const LADO_MAXIMO = 1600;
const CALIDAD_JPEG = 0.8;

export interface FotoLista {
  tipoMime: 'image/jpeg';
  /** Base64 sin el prefijo data:. */
  datos: string;
}

function cargarImagen(archivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

export async function prepararFoto(archivo: File): Promise<FotoLista> {
  if (!archivo.type.startsWith('image/')) {
    throw new Error('El archivo no es una imagen.');
  }
  const img = await cargarImagen(archivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * escala);
  canvas.height = Math.round(img.naturalHeight * escala);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no pudo procesar la imagen.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', CALIDAD_JPEG);
  return { tipoMime: 'image/jpeg', datos: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}
