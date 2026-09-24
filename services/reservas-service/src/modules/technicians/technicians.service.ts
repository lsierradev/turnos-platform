import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Raw, Repository } from 'typeorm';
import { buscarTecnico, esRolTecnico } from '../../common/tecnicos.util';
import {
  inicioDelDiaEnZona,
  sumarDiasFecha,
  zonaHorariaNegocio,
} from '../../common/zona-horaria.util';
import { Turno } from '../../entities/turno.entity';

@Injectable()
export class TechniciansService {
  constructor(
    @InjectRepository(Turno)
    private readonly turnosRepository: Repository<Turno>,
    private readonly dataSource: DataSource,
  ) {}

  async listar(): Promise<{ id: string; nombre: string }[]> {
    return this.dataSource.query(
      `SELECT id, nombre FROM usuarios WHERE rol = 'tecnico' ORDER BY nombre, id`,
    );
  }

  /** @param fecha dia de negocio, YYYY-MM-DD (ver fechaDeNegocio). */
  async agendaDelDia(tecnicoId: string, fecha: string): Promise<Turno[]> {
    const tecnico = await buscarTecnico(this.dataSource, tecnicoId);
    if (!tecnico || !esRolTecnico(tecnico.rol)) {
      throw new NotFoundException(
        `Tecnico ${tecnicoId} no encontrado o no tiene rol de tecnico`,
      );
    }

    // Dia del TALLER, no dia UTC: en Bogota el dia UTC arranca a las 19:00,
    // asi que un turno de las 20:00 locales aparecia en la agenda de
    // manana.
    const zona = zonaHorariaNegocio();
    const desde = inicioDelDiaEnZona(fecha, zona);
    const hasta = inicioDelDiaEnZona(sumarDiasFecha(fecha, 1), zona);

    // El filtro por fecha va en SQL, no en memoria.
    //
    // Antes esto era find({ where: { tecnicoId } }) seguido de un .filter()
    // en JS: traia TODOS los turnos historicos del tecnico, con sus joins de
    // bahia y servicio, en cada carga de la agenda -- y despues descartaba
    // casi todos. Con un tecnico de un ano de antiguedad son miles de filas
    // por request, lo que rompe el criterio de p95 < 300 ms del SRS.
    //
    // El operador && sobre el rango es lo que sabe resolver el indice GiST
    // de turnos_tecnico_rango_excl (006), que ya lleva tecnico_id como
    // primera columna: no hace falta un indice nuevo.
    //
    // La segunda condicion mantiene la semantica original ("turnos que
    // EMPIEZAN este dia", no los que vienen del dia anterior y todavia no
    // terminaron); && sola seria un superconjunto.
    const turnos = await this.turnosRepository.find({
      where: {
        tecnicoId,
        rangoTiempo: Raw(
          (alias) =>
            `${alias} && tstzrange(:desde, :hasta, '[)') AND lower(${alias}) >= :desde`,
          { desde, hasta },
        ),
      },
      relations: ['bahia', 'servicio'],
    });

    // El orden se resuelve aca y no con ORDER BY porque ordenar por
    // lower(rango_tiempo) en la API de find() de TypeORM no es directo, y a
    // esta altura la lista es la de un solo dia: decenas de filas, no miles.
    return turnos.sort(
      (a, b) => a.rangoTiempo.inicio.getTime() - b.rangoTiempo.inicio.getTime(),
    );
  }
}
