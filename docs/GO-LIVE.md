# Checklist final de Go-Live

Sprint 10 · issue #44 · basado en los Criterios de Aceptación Generales del
SRS (§14).

Este documento es la puerta. El detalle de cada criterio está en
[QA-CHECKLIST.md](QA-CHECKLIST.md); acá está lo que hay que poder responder
**sí** antes de abrir al público.

## Veredicto

**No se puede salir a producción todavía.** Hay un bloqueante duro y tres
verificaciones que nunca se ejecutaron.

| | Tema | Estado |
|---|---|---|
| 🔴 | `admin-web` no tiene login | **Bloqueante duro** |
| 🟠 | Nada de la infraestructura fue aplicado ni validado | Bloqueante de #40 |
| 🟠 | p95 nunca se midió | Bloqueante de CA-2 |
| 🟠 | La suite E2E nunca se ejecutó | Bloqueante |
| ⚪ | Sprint 7 (Pagos) no existe | Fuera de alcance, confirmar |

---

## 🔴 Bloqueante duro: el panel no tiene autenticación

`admin-web` **no tiene pantalla de login**. La sesión es un token de
desarrollo que Vite hornea en el bundle vía `VITE_DEV_TOKEN`
(`apps/admin-web/src/lib/api-client.ts`).

En desarrollo es una comodidad. En un entorno público es una de dos cosas,
las dos malas:

- **Si se hornea un token de admin en la imagen:** cualquiera que abra las
  devtools lo copia y obtiene acceso de administrador completo —KPIs del
  taller, agenda de todos los técnicos, capacidad de cerrar turnos ajenos—.
  El token ni siquiera hay que robarlo: viaja en el JavaScript público.
- **Si no se hornea ninguno** (que es lo que hace el `Dockerfile`, porque
  rechaza ese build-arg a propósito): el panel construye bien, carga, y
  **toda llamada a la API devuelve 401**. No sirve para nada.

No hay forma de desplegar el panel con lo que hay hoy. Esto no lo arregla la
infraestructura.

**Qué falta** (nunca estuvo en el alcance de ningún sprint):

- [ ] Pantalla de login contra `POST /auth/login`
- [ ] Guardar el token y renovarlo con `POST /auth/refresh` antes de que
      expire (los access token duran 15 min)
- [ ] Guardas de ruta y logout
- [ ] Manejo del 401 y del 403 en `api-client.ts` (hoy un token vencido se ve
      igual que un "no encontrado" — es el hallazgo 3 de `UX-NOTES.md`)

Mientras tanto, **la API sí es desplegable**: tiene autenticación y
autorización por rol completas. Lo que no se puede publicar es el panel.

---

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
- [ ] **Correr la medición.** Nunca se ejecutó:
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

- [ ] **Construir las tres imágenes.** Nunca se construyó ninguna; los
      Dockerfiles no se ejecutaron.
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
