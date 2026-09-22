import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { RolUsuario, Usuario } from './entities/usuario.entity';

const SALT_ROUNDS = 10;

export interface CrearUsuarioInput {
  email: string;
  password: string;
  nombre: string;
  rol?: RolUsuario;
  telefono?: string;
}

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
  ) {}

  health() {
    return { status: 'ok', module: 'usuarios' };
  }

  findByEmail(email: string): Promise<Usuario | null> {
    return this.usuariosRepository.findOne({ where: { email } });
  }

  async create(input: CrearUsuarioInput): Promise<Usuario> {
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const usuario = this.usuariosRepository.create({
      email: input.email,
      passwordHash,
      nombre: input.nombre,
      rol: input.rol ?? RolUsuario.CLIENTE,
      telefono: input.telefono,
    });
    return this.usuariosRepository.save(usuario);
  }
}
