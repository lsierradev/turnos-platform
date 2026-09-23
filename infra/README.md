# infra

Infraestructura como código: contenedores, manifiestos de despliegue y
scripts de verificación.

> **Nada de lo que hay acá fue aplicado ni validado contra un cluster real.**
> Está escrito a partir del código de este repo, pero no se construyó ninguna
> imagen ni se desplegó nada. La validación es lo que pide la issue #40 y
> sigue pendiente.

## Contenido

| Ruta | Qué es |
|---|---|
| `k8s/` | Manifiestos de Kubernetes, numerados por orden de aplicación |
| `scripts/verificar-salud.sh` | Smoke test post-deploy (issue #41) |

Los `Dockerfile` viven junto a cada componente, no acá:
`services/*/Dockerfile` y `apps/admin-web/Dockerfile`. Los tres se
construyen con **la raíz del monorepo como contexto**, porque dependen de
`packages/`.

## Arquitectura objetivo

```
                      Route 53
                         │
                    ALB (un solo LB, IngressGroup)
         ┌───────────────┼───────────────┐
  turnos.dominio    api.dominio     auth.dominio
         │               │               │
     admin-web    reservas-service  usuarios-service
     (nginx x2)        (x2)              (x2)
                         │               │
                    ┌────┴───────────────┘
                    │
        RDS PostgreSQL 16      ElastiCache Redis 7
        (gestionado)           (gestionado)
```

Postgres y Redis son **servicios gestionados**, fuera del cluster. Para un
SLA de 99.9 % el backup, el failover y los parches los maneja AWS: meterlos
como StatefulSets dentro de EKS traslada ese trabajo al equipo, y es
justamente lo que suele romper ese número.

**Los dos servicios comparten la misma base de datos.** No es un descuido:
`reservas-service` consulta la tabla `usuarios` con SQL crudo para validar
roles de técnico (ver `common/tecnicos.util.ts`). Si algún día se separan,
eso tiene que convertirse en una llamada HTTP.

## Orden de despliegue

```sh
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/10-configmap.yaml
# el Secret NO está en el repo: ver k8s/20-secret.example.yaml
kubectl apply -f /ruta/fuera/del/repo/secret.yaml

# Migraciones ANTES que los servicios
kubectl apply -f k8s/60-migraciones-job.yaml
kubectl wait --for=condition=complete --timeout=300s job/migraciones -n turnos-platform

kubectl apply -f k8s/30-reservas-service.yaml
kubectl apply -f k8s/40-usuarios-service.yaml
kubectl apply -f k8s/50-admin-web.yaml
kubectl apply -f k8s/70-ingress.yaml
```

El detalle completo, con los prerequisitos de AWS, está en
[`docs/DESPLIEGUE.md`](../docs/DESPLIEGUE.md).

## Qué hay que reemplazar antes de aplicar

Los manifiestos tienen marcadores literales `REEMPLAZAR` y `ACCOUNT`:

- URIs de imágenes de ECR (`ACCOUNT.dkr.ecr.REGION.amazonaws.com/...`) con un
  **tag inmutable**, nunca `:latest`.
- ARN del certificado de ACM.
- Los tres nombres de host.
- Todos los valores del Secret.

```sh
grep -rn "REEMPLAZAR\|ACCOUNT\." k8s/
```

## Lo que falta

- **El cluster necesita AWS Load Balancer Controller instalado** (no viene
  con EKS). Sin él los Ingress se crean pero no provisionan nada, y el
  síntoma es un Ingress sin `ADDRESS` y ningún error visible.
- No hay Terraform ni CloudFormation: la VPC, el cluster EKS, RDS,
  ElastiCache y ECR se asumen ya creados (issue #40).
- No hay pipeline de CD. CI construye y prueba, pero nadie publica imágenes
  ni aplica manifiestos todavía.
- No hay HorizontalPodAutoscaler. Con 2 réplicas fijas alcanza para el beta;
  antes de abrir a tráfico real conviene agregarlo, apoyado en la medición
  de p95 que pide `docs/QA-CHECKLIST.md`.
