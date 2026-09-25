import { formatearPesos } from '../../common/dinero.util';
import { fechaEnZona, horaEnZona } from '../../common/zona-horaria.util';

/**
 * Orden de trabajo (Sprint 22): el turno con su recepcion, la atencion y
 * la garantia. Es lo que se imprime en el taller y, desde la aceptacion,
 * la constancia que le llega al cliente por correo.
 */
export interface OrdenTrabajo {
  /** Consecutivo del taller; null hasta que se recibe el vehiculo. */
  numero: number | null;
  taller: {
    id: string;
    nombre: string;
    razonSocial: string | null;
    nit: string | null;
    dv: number | null;
    direccion: string | null;
    municipio: string | null;
  };
  cliente: {
    id: string;
    nombre: string;
    email: string;
    telefono: string | null;
  } | null;
  turno: {
    id: string;
    inicio: string;
    fin: string;
    estado: 'programado' | 'atendido' | 'no_asistio' | 'cancelado';
    bahia: string;
    servicio: { id: string; nombre: string; categoria: string };
    tecnico: { id: string; nombre: string } | null;
    precio: {
      baseCentavos: number;
      ivaCentavos: number;
      totalCentavos: number;
      tarifaIva: number | null;
    } | null;
    anticipo: { centavos: number; porStrikes: boolean } | null;
    canceladoPor: 'cliente' | 'taller' | null;
    motivoCancelacion: string | null;
  };
  vehiculo: {
    id: string;
    placa: string;
    marca: string;
    modelo: string;
    anio: number;
    kilometraje: number;
  } | null;
  recepcion: {
    id: string;
    numero: number;
    kilometraje: number;
    nivelCombustible: number;
    estadoVehiculo: string;
    objetosDejados: string;
    observaciones: string | null;
    fechaProbableEntrega: string;
    recibidoPor: string | null;
    creadoEn: string;
    aceptacion: {
      en: string;
      medio: 'cuenta' | 'presencial';
      nombre: string | null;
      documento: string | null;
    } | null;
    fotos: { id: string; tipoMime: string }[];
  } | null;
  atencion: { inicio: string | null; fin: string | null; notas: string | null };
  garantia: {
    /** null: no definida para el servicio; rige la garantia legal. */
    dias: number | null;
    /** Solo cuando el turno se cerro como atendido. */
    hasta: string | null;
    texto: string;
  };
}

export const NIVELES_COMBUSTIBLE = [
  'Reserva',
  '1/4',
  '1/2',
  '3/4',
  'Lleno',
] as const;

/**
 * Leyenda de garantia de la orden (Decreto 735 de 2013). Un termino
 * inventado es peor que ninguno: sin termino del servicio, se remite a la
 * garantia legal en vez de imprimir un numero.
 */
export function textoGarantia(
  dias: number | null,
  hasta: string | null,
): string {
  if (dias === null) {
    return 'El taller no definio un termino de garantia para este servicio: rige la garantia legal (Ley 1480 de 2011 y Decreto 735 de 2013).';
  }
  if (dias === 0) {
    return 'Servicio sin termino de garantia adicional: rige la garantia legal (Ley 1480 de 2011 y Decreto 735 de 2013).';
  }
  const plazo = `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  return hasta
    ? `Garantia del servicio: ${plazo} desde la entrega, hasta el ${hasta} inclusive (Decreto 735 de 2013).`
    : `Garantia del servicio: ${plazo} desde la entrega del vehiculo (Decreto 735 de 2013).`;
}

function fechaHora(iso: string, zona: string): string {
  const d = new Date(iso);
  return `${fechaEnZona(d, zona)} ${horaEnZona(d, zona)}`;
}

/**
 * La constancia de entrega para reparacion (Ley 1480 de 2011, art. 18) en
 * texto plano, para el correo. Requiere la recepcion.
 */
export function textoConstancia(orden: OrdenTrabajo, zona: string): string {
  const r = orden.recepcion;
  if (!r) throw new Error('La orden no tiene recepcion');
  const t = orden.taller;
  const v = orden.vehiculo;
  const nit = t.nit ? `NIT ${t.nit}${t.dv !== null ? `-${t.dv}` : ''}` : null;
  const lineas: (string | null)[] = [
    `CONSTANCIA DE RECEPCION DEL VEHICULO - Orden de trabajo N.° ${r.numero}`,
    '',
    `${t.razonSocial ?? t.nombre}${nit ? ` · ${nit}` : ''}`,
    t.direccion
      ? `${t.direccion}${t.municipio ? `, ${t.municipio}` : ''}`
      : null,
    '',
    `Recibido: ${fechaHora(r.creadoEn, zona)} (hora del taller)`,
    `Fecha probable de entrega: ${fechaHora(r.fechaProbableEntrega, zona)}`,
    orden.cliente
      ? `Cliente: ${orden.cliente.nombre} · ${orden.cliente.email}${orden.cliente.telefono ? ` · ${orden.cliente.telefono}` : ''}`
      : null,
    v ? `Vehiculo: ${v.marca} ${v.modelo} ${v.anio} · placa ${v.placa}` : null,
    `Servicio: ${orden.turno.servicio.nombre}`,
    orden.turno.precio
      ? `Valor: ${formatearPesos(orden.turno.precio.totalCentavos)}${orden.turno.precio.tarifaIva !== null ? ' (IVA incluido)' : ''}`
      : null,
    '',
    `Kilometraje: ${r.kilometraje.toLocaleString('es-CO')} km`,
    `Combustible: ${NIVELES_COMBUSTIBLE[r.nivelCombustible] ?? r.nivelCombustible}`,
    `Estado del vehiculo: ${r.estadoVehiculo}`,
    `Objetos dejados en el vehiculo: ${r.objetosDejados}`,
    r.observaciones ? `Observaciones: ${r.observaciones}` : null,
    r.fotos.length
      ? `Fotos de la recepcion: ${r.fotos.length} (quedan en la orden)`
      : null,
    '',
    orden.garantia.texto,
    '',
    r.aceptacion
      ? r.aceptacion.medio === 'presencial'
        ? `Aceptada en el taller por ${r.aceptacion.nombre} (documento ${r.aceptacion.documento}) el ${fechaHora(r.aceptacion.en, zona)}.`
        : `Aceptada por el cliente desde su cuenta el ${fechaHora(r.aceptacion.en, zona)}.`
      : null,
  ];
  return lineas.filter((l) => l !== null).join('\n');
}
