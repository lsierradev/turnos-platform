export interface JwtPayload {
  sub: string;
  email: string;
  rol: string;
  /**
   * Taller del personal (admin, tecnico) desde Sprint 20. null para el
   * cliente (es global: elige el taller en cada reserva) y el superadmin
   * (elige en cual opera). Tokens emitidos antes de Sprint 20 no lo traen.
   */
  taller?: string | null;
}
