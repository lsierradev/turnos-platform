# Despliegue

Sprint 10 · issue #43 · cómo llevar turnos-platform de este repo a un cluster.

> **Advertencia:** este procedimiento no se ejecutó nunca. Los Dockerfiles y
> manifiestos están escritos a partir del código, pero no se construyó
> ninguna imagen ni se aplicó nada contra un cluster. La primera corrida es
> parte de la issue #40 y hay que hacerla en un entorno de staging, no en
> producción.

## Componentes

| Componente | Imagen | Puerto | Dependencias |
|---|---|---|---|
| `reservas-service` | `services/reservas-service/Dockerfile` | 3001 | Postgres, Redis |
| `usuarios-service` | `services/usuarios-service/Dockerfile` | 3002 | Postgres |
| `admin-web` | `apps/admin-web/Dockerfile` | 8080 | — (estáticos) |

Los tres se construyen con **la raíz del monorepo como contexto**, porque
dependen de `packages/auth` y `packages/http`.

---

## 1. Verificar local antes de subir nada

```sh
docker compose --profile full up -d --build
./infra/scripts/verificar-salud.sh
```

Eso levanta Postgres, Redis, aplica las migraciones y arranca los tres
servicios con las imágenes reales. Si algo falla acá, va a fallar igual en el
cluster y es mucho más barato descubrirlo ahora.

`docker compose up -d` sin `--profile full` sigue levantando solo Postgres y
Redis, que es el flujo de desarrollo de siempre.

## 2. Construir y publicar imágenes

```sh
export ECR=ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/turnos-platform
export TAG=$(git rev-parse --short HEAD)

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "$ECR"

docker build -f services/reservas-service/Dockerfile -t "$ECR/reservas-service:$TAG" .
docker build -f services/usuarios-service/Dockerfile -t "$ECR/usuarios-service:$TAG" .
docker build -f apps/admin-web/Dockerfile \
  --build-arg VITE_API_URL=https://api.ejemplo.com \
  --build-arg VITE_AUTH_URL=https://auth.ejemplo.com \
  -t "$ECR/admin-web:$TAG" .

docker push "$ECR/reservas-service:$TAG"
docker push "$ECR/usuarios-service:$TAG"
docker push "$ECR/admin-web:$TAG"
```

**El tag es el sha del commit, nunca `:latest`.** Con `:latest`, un pod que
reinicia puede levantar una imagen distinta a la de sus hermanos, y durante
un incidente es imposible saber qué versión está corriendo.

### `VITE_API_URL` se hornea en el bundle

Vite resuelve `import.meta.env.VITE_*` en tiempo de **build** y escribe el
valor literal en el JavaScript que baja el navegador. Dos consecuencias que
hay que tener presentes:

1. **Una imagen por entorno.** La de staging no se puede promover a
   producción: hay que reconstruirla con la URL correcta.
2. **Nada que se pase por ahí es secreto.** Cualquiera que abra las
   devtools lo ve.

Las dos variables que se hornean son URLs, no secretos. Desde Sprint 10 el
panel tiene login propio, así que **no se hornea ningún token**: la sesión se
obtiene en runtime contra `usuarios-service`.

## 3. Prerequisitos de AWS

Nada de esto lo crean los manifiestos; se asume existente (issue #40):

- **VPC** con subredes privadas para los nodos y públicas para el ALB.
- **Cluster EKS** con un node group.
- **RDS PostgreSQL 16**, alcanzable desde los nodos. Necesita las extensiones
  `btree_gist` y `pgcrypto`; las migraciones las crean con
  `CREATE EXTENSION IF NOT EXISTS`, pero el usuario de la base tiene que
  tener permiso para hacerlo.
- **ElastiCache Redis 7**, alcanzable desde los nodos.
- **Repositorios ECR** para las tres imágenes.
- **Certificado ACM** que cubra los tres hosts (un wildcard alcanza).
- **AWS Load Balancer Controller** instalado en el cluster, con su rol IAM
  vía IRSA. No viene con EKS. Sin él los Ingress se crean pero no
  provisionan nada, y el síntoma es un Ingress sin `ADDRESS` y ningún error.

### CORS

`CORS_ORIGINS` es **obligatoria en producción**: si falta, los servicios no
arrancan. Tiene que listar el origen del panel, con esquema y sin barra
final:

```
CORS_ORIGINS=https://turnos.ejemplo.com
```

Si no coincide exactamente, el panel carga pero **todas** las llamadas
fallan, y el error solo aparece en la consola del navegador — no en los logs
del backend, porque el request nunca llega.

### Security groups

El grupo de los nodos debe poder salir a:

- RDS por 5432
- ElastiCache por 6379
- Internet por 443 (SendGrid y Twilio)

## 4. Secretos

```sh
cp infra/k8s/20-secret.example.yaml /tmp/secret.yaml   # FUERA del repo
# completar valores
kubectl apply -f /tmp/secret.yaml
rm /tmp/secret.yaml
```

Tres cosas que se pagan caro si se equivocan:

- **`JWT_SECRET` tiene que ser idéntico en los dos servicios.**
  `usuarios-service` firma los access token y `reservas-service` los valida.
  Si se desalinean, el login funciona y después *toda* llamada a reservas
  devuelve 401 — un síntoma que no apunta para nada a la causa.
- **Si falta cualquiera de los secretos, el servicio no arranca.** Es
  deliberado (`packages/auth/src/secretos.util.ts`): sin ellos firmaría
  tokens con el secreto de desarrollo, que está publicado en este
  repositorio. Un `CrashLoopBackOff` con ese mensaje significa que faltan
  variables, no que la imagen esté rota.
- **`ENCRYPTION_KEY` no es rotable.** Cifra los teléfonos de los usuarios
  (AES-256-GCM). Cambiarla después de tener datos los vuelve ilegibles y no
  hay proceso de re-cifrado. Generar una vez con `openssl rand -hex 32` y
  guardarla donde se pueda recuperar.

## 5. Desplegar

```sh
kubectl apply -f infra/k8s/00-namespace.yaml
kubectl apply -f infra/k8s/10-configmap.yaml
kubectl apply -f /tmp/secret.yaml

# Migraciones ANTES que los servicios
kubectl apply -f infra/k8s/60-migraciones-job.yaml
kubectl wait --for=condition=complete --timeout=300s job/migraciones -n turnos-platform

kubectl apply -f infra/k8s/30-reservas-service.yaml
kubectl apply -f infra/k8s/40-usuarios-service.yaml
kubectl apply -f infra/k8s/50-admin-web.yaml
kubectl apply -f infra/k8s/70-ingress.yaml
```

Las migraciones van en un `Job` y no en un `initContainer` porque con 2
réplicas dos initContainers intentarían migrar en paralelo: el script es
idempotente, pero dos procesos corriendo el mismo `ALTER TABLE` se bloquean
entre sí.

Son aditivas, así que la versión vieja del código sigue funcionando contra el
esquema nuevo mientras dura el rolling update.

## 6. Verificar

```sh
kubectl get pods -n turnos-platform
kubectl get ingress -n turnos-platform     # debe tener ADDRESS

BASE_API=https://api.ejemplo.com \
BASE_AUTH=https://auth.ejemplo.com \
BASE_WEB=https://turnos.ejemplo.com \
./infra/scripts/verificar-salud.sh
```

El script comprueba liveness, readiness (que los servicios *alcancen* sus
dependencias) y que los endpoints protegidos efectivamente rechacen a quien
no manda token. Sale con código distinto de cero si algo falla, así que sirve
como paso de un pipeline.

## Actualizar una versión

```sh
kubectl set image deployment/reservas-service \
  reservas-service="$ECR/reservas-service:$TAG" -n turnos-platform
kubectl rollout status deployment/reservas-service -n turnos-platform
```

Con `maxUnavailable: 0` el rollout no saca una réplica hasta tener la nueva
lista, así que no hay ventana de caída.

## Rollback

```sh
kubectl rollout undo deployment/reservas-service -n turnos-platform
```

**El rollback de código no deshace una migración.** Las de este repo son
aditivas —agregan columnas y constraints, no borran— así que volver a la
imagen anterior funciona. Si alguna vez se escribe una migración destructiva,
eso deja de ser cierto y hace falta un plan de reversión propio.

## Operación

### Ver por qué un pod no está listo

```sh
kubectl describe pod <pod> -n turnos-platform
kubectl exec -n turnos-platform <pod> -- \
  node -e "fetch('http://localhost:3001/reservas/health/ready').then(r=>r.text()).then(console.log)"
```

El cuerpo del readiness dice **cuál** dependencia se cayó, no solo que algo
anda mal.

### Buscar un error reportado por un usuario

Toda respuesta de error trae un `requestId` que además se escribe en el log:

```sh
kubectl logs -n turnos-platform -l app.kubernetes.io/name=reservas-service --tail=1000 \
  | grep "<requestId>"
```

### Notificaciones que no salieron

```sh
kubectl logs -n turnos-platform -l app.kubernetes.io/name=reservas-service \
  | grep "Cobertura de recordatorios incompleta\|en estado pendiente"
```

Un cron cada 30 min detecta turnos inminentes sin notificación registrada y
notificaciones que la cola nunca procesó. Conviene tener una alerta sobre
esas dos líneas.

## Limitaciones conocidas

- **Sin pipeline de CD**: las imágenes se construyen y aplican a mano.
- **Sin Terraform**: la infraestructura de AWS se asume creada.
- **Sin HPA**: 2 réplicas fijas.
- **`admin-web` no tiene login** — ver [GO-LIVE.md](GO-LIVE.md). Es el
  bloqueante que impide desplegar el panel a un entorno público.
