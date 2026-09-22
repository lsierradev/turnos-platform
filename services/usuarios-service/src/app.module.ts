import { Module } from '@nestjs/common';
import { UsuariosModule } from './modules/usuarios/usuarios.module';

@Module({
  imports: [UsuariosModule],
})
export class AppModule {}
