import { Injectable } from '@nestjs/common';

@Injectable()
export class ReservasService {
  health() {
    return { status: 'ok', module: 'reservas' };
  }
}
