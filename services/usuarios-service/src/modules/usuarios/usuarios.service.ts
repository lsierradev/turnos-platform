import { Injectable } from '@nestjs/common';

@Injectable()
export class UsuariosService {
  health() {
    return { status: 'ok', module: 'usuarios' };
  }
}
