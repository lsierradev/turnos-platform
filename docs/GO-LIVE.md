# Checklist final de Go-Live

Sprint 10 · issue #44 · basado en los Criterios de Aceptación Generales del
SRS (§14).

Este documento es la puerta. El detalle de cada criterio está en
[QA-CHECKLIST.md](QA-CHECKLIST.md); acá está lo que hay que poder responder
**sí** antes de abrir al público.

## Veredicto

| | Tema | Estado |
|---|---|---|
| ✅ | `admin-web` no tenía login | **Resuelto** |
| ✅ | Los servicios no arrancaban contra Postgres | **Resuelto** |
| ✅ | No había CORS | **Resuelto** |
| 🟠 | Nada de la infraestructura fue aplicado en un cluster | Bloqueante de #40 |
| 🟠 | p95, E2E y build de imágenes: automatizados, falta ver el resultado | Bloqueante |
| ⚪ | Sprint 7 (Pagos) no existe | Fuera de alcance, confirmar |

Las tres verificaciones que faltaban ahora corren **solas en CI** (jobs
`e2e-tests`, `latencia` y `docker-build`). Lo que queda es mirar que pasen en
verde y aplicar los manifiestos en un cluster de staging.

---

## ✅ Resuelto: el panel ya tiene autenticación

Hasta Sprint 10 la sesión era un token de desarrollo horneado en el bundle,
lo que dejaba dos opciones y las dos malas: repartir acceso de administrador
a cualquiera que abriera las devtools, o un panel que devolvía 401 en cada
llamada.

Implementado:

- [x] Pantalla de login contra `POST /auth/login`
- [x] Renovación automática con `POST /auth/refresh` al vencer el access
      token, con una sola petición compartida aunque haya varias llamadas en
      vuelo (el dashboard hace polling cada 2 s)
- [x] Guardas de ruta, cierre de sesión y menú según el rol
- [x] 401 y 403 con mensajes distintos (resuelve el hallazgo 3 de
      `UX-NOTES.md`: antes una sesión vencida se veía igual que un "no
      encontrado")
- [x] Cubierto por `e2e/tests/acceso.spec.ts`

**La sesión se guarda en `sessionStorage`**, no en `localStorage`: el panel se
usa en computadoras compartidas del taller, y así cerrar la pestaña cierra la
sesión. El límite conocido es que cualquier almacenamiento accesible por
JavaScript es legible por un XSS; la alternativa robusta es una cookie
httpOnly, que exige manejo de cookies y CSRF en el backend.

- [ ] Evaluar el paso a cookie httpOnly antes de abrir a usuarios fuera del
      taller.

---

## ✅ Resuelto: los servicios no arrancaban contra Postgres

Detectado al revisar por qué CI estaba en rojo desde Sprint 6.
`Notificacion.error` y `Notificacion.enviadoEn` estaban declarados como
`@Column({ nullable: true })` sobre tipos `string | null` y `Date | null`.
TypeScript emite `Object` como metadato para una unión, TypeORM no sabe
mapearlo a Postgres, y **aborta en `DataSource.initialize()`**: el servicio no
arrancaba, no era que fallara una consulta.

`Usuario.telefono` tenía el mismo defecto, sin detectar: `usuarios-service`
no tenía ningún test que levantara la aplicación contra una base real.

- [x] Tipos de columna declarados explícitamente en los tres casos
- [x] `usuarios-service` tiene ahora su propio spec de integración que
      arranca `AppModule` contra Postgres — el test más barato que cierra
      esta clase entera de fallas
- [x] CI corre los dos specs de integración

La suite unitaria estuvo en verde todo el tiempo, porque mockea el
`DataSource`. Es la lección que deja: hay defectos que solo aparecen al
conectar de verdad.

## ✅ Resuelto: no había CORS

Ningún servicio llamaba a `enableCors()`. En producción el panel vive en otro
host que las APIs, así que el navegador habría bloqueado **todas** las
llamadas antes de que salieran — y el síntoma aparece solo en la consola del
navegador, no en los logs del backend.

- [x] `CORS_ORIGINS` en ambos servicios, **obligatoria en producción** (sin
      ella no arrancan). Nada de comodín: reflejar cualquier origen en un
      servicio que recibe el token por header dejaría que cualquier sitio
      hiciera llamadas autenticadas desde el navegador de un usuario
      logueado.

## Criterios de aceptación (SRS §14)

### CA-1 · Cero reservas duplicadas ✅

- [x] Tres constraints `EXCLUDE USING gist` en Postgres: por bahía, por
      técnico y por cliente. La garantía está en la base, no en el código.
- [x] Verificado con 2 requests en paralelo (integración), 50 simultáneos
      (k6) y 5 clientes distintos (E2E).
- [ ] Confirmar con el CDA que un mismo cliente **no** deba poder tener dos
      turnos solapados. Si necesitan atender dos vehículos del mismo cliente
      en paralelo, hay que revertir la migración 010.

### CA-2 · Respuesta < 300 ms p95 ⚠️

- [x] Las dos consultas que recorrían el histórico completo ahora filtran por
      rango en SQL.
- [x] Automatizado en CI: el job `latencia` siembra ~5800 turnos, corre
      `ANALYZE` y ejecuta k6 con thresholds por endpoint.
- [ ] **Ver el resultado en verde.** También se puede correr a mano:
      ```sh
      node services/reservas-service/load-tests/seed.js > .k6-env.sh && source .k6-env.sh
      node services/reservas-service/load-tests/seed-volumen.js
      k6 run services/reservas-service/load-tests/latencia-lectura.k6.js
      ```
      El paso de volumen no es opcional: contra una base vacía la medición
      pasa siempre y no prueba nada.
- [ ] Repetir contra RDS, no solo en local: la latencia de red hacia una base
      gestionada no aparece en una Postgres en `localhost`.

### CA-3 · 100 % de notificaciones con estado registrado ✅

- [x] Toda notificación queda registrada antes de intentarse, con estado,
      intentos y error.
- [x] Cron de reconciliación cada 30 min que detecta los dos huecos que la
      tabla no muestra sola.
- [ ] **Alerta de monitoreo** sobre esas dos líneas de log. Sin alerta, el
      cron escribe en un log que nadie mira.
- [ ] Credenciales reales de SendGrid y Twilio cargadas (issue #32). Sin
      ellas todo queda en `fallido` tras 3 intentos.
- [ ] Decidir si un usuario sin teléfono (solo email) cuenta como
      notificación cumplida.

### CA-4 · SLA 99.9 % ⚠️

99.9 % ≈ **43 minutos de caída al mes**. No se aprueba antes de salir: se
empieza a medir. Lo verificable ahora son los prerequisitos.

- [x] Health checks que comprueban dependencias, con liveness y readiness
      separados y 503 cuando algo falla.
- [x] 2 réplicas de cada servicio, repartidas entre nodos, con
      `PodDisruptionBudget` y rolling update sin ventana de caída.
- [x] Errores que no son caídas (statement timeout, uuid mal formado) fuera
      de la métrica de 5xx.
- [ ] Probes configurados en el deploy real y **verificados** (issue #41).
- [ ] Monitoreo y alertas que produzcan el número de disponibilidad. Sin
      esto el SLA no es verificable ni después de salir.
- [ ] **Definir el alcance del SLA con el CDA.** Un taller que no puede
      reservar está caído; uno que no ve el dashboard, no. Conviene que el
      compromiso sea explícito.
- [ ] Probar un failover de RDS y confirmar que los pods se recuperan solos.

### CA-5 · Desfase del panel < 5 s ✅

- [x] Polling de 2 s + caché de 2 s en el backend: peor caso 4 s.
- [x] El caché acota el costo a una consulta cada 2 s sin importar cuántos
      paneles haya abiertos.
- [ ] Verificar con varios paneles abiertos que `POST /appointments` sigue
      dentro de CA-2.
- [x] `/admin` queda **fuera del alcance del beta**: sigue con datos mock
      porque no existe endpoint de carga por bahía. El panel que usa el CDA
      es `/dashboard`.

---

## Infraestructura (#40)

- [x] El job `docker-build` de CI construye las tres imágenes en cada push.
      Es lo máximo que se puede validar sin un cluster.
- [ ] **Ver ese job en verde.**
- [ ] Verificar local con `docker compose --profile full up -d --build` y
      `./infra/scripts/verificar-salud.sh`.
- [ ] VPC, EKS, RDS, ElastiCache, ECR y certificado ACM creados.
- [ ] AWS Load Balancer Controller instalado (no viene con EKS).
- [ ] Secretos cargados. **`JWT_SECRET` idéntico en los dos servicios.**
- [ ] `ENCRYPTION_KEY` guardada donde se pueda recuperar: no es rotable, y
      cambiarla vuelve ilegibles los teléfonos ya cifrados.
- [ ] Migraciones aplicadas con el Job, antes de los servicios.
- [ ] Reemplazar todos los marcadores:
      `grep -rn "REEMPLAZAR\|ACCOUNT\." infra/k8s/`
- [ ] Desplegar primero en **staging** y correr ahí la suite E2E completa.

## Seguridad

- [x] Autenticación JWT y autorización por rol en todos los endpoints.
- [x] Teléfonos cifrados en reposo (AES-256-GCM).
- [x] Los servicios no arrancan en producción sin sus secretos.
- [x] Contenedores sin root, sin escalada de privilegios, filesystem de solo
      lectura.
- [x] HTTPS forzado en el ALB.
- [ ] **Login del panel** (ver el bloqueante de arriba).
- [ ] Rotar cualquier secreto que haya estado en un `.env` compartido o en un
      chat durante el desarrollo.
- [ ] Revisar quién tiene acceso a la base de producción.
- [ ] Confirmar que el `.env` de desarrollo nunca llegó al repo:
      `git log --all --diff-filter=A -- "*.env"`

## Datos y respaldo

- [ ] Backups automáticos de RDS activados, con retención acordada.
- [ ] **Probar una restauración**, no solo que el backup exista. Un backup
      que nunca se restauró no es un backup.
- [ ] Definir qué pasa con los datos del beta: ¿se conservan al pasar a
      producción o se arranca limpio?

## Operación

- [ ] Alertas configuradas: 5xx, pods no listos, cobertura de
      notificaciones, latencia p95.
- [ ] Definir a quién se le avisa y por qué canal cuando algo se cae.
- [ ] `docs/DESPLIEGUE.md` leído por alguien que no lo escribió, y que ese
      alguien pueda hacer un rollback.

## Alcance

- [ ] **Confirmar que el beta sale sin pagos.** Sprint 7 no está
      implementado: 4 issues abiertas y ningún código de pagos en el repo.
      Si el CDA espera cobrar por la plataforma, eso no existe.
- [ ] Confirmar que sale sin flujo de reserva para el cliente final: hoy
      reservar es una llamada a la API, no una pantalla.

---

## Resumen para decidir

Lo que **sí** está listo: la API completa, con las cuatro historias de
usuario funcionando, autenticación y autorización, la garantía de cero
reservas duplicadas a nivel de base de datos, y las notificaciones con
estado auditable.

Lo que **no**: el panel no se puede publicar sin login, la infraestructura
nunca se aplicó, y dos de las suites de verificación (E2E y p95) nunca se
ejecutaron.

Un beta cerrado **solo de API** —con el CDA usando Postman o un cliente
propio— sería viable apenas se valide la infraestructura. Un beta con panel
necesita el login primero.
