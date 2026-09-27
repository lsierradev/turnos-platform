# Documentos legales

Sprint 23. **Todos son borradores para revisión de un abogado.** No se
debe salir a producción con ellos tal cual: ver [PENDIENTES.md](PENDIENTES.md).

## Los documentos

| Documento | Archivo | Quién lo acepta | Cuándo |
|---|---|---|---|
| Términos y Condiciones TurnoPro ↔ taller, con el Anexo 1 (contrato de transmisión de datos) | [terminos-taller-v1.md](../../services/usuarios-service/src/modules/legal/textos/terminos-taller-v1.md) | Un admin, por su taller | Primer ingreso y cada versión nueva |
| Política de Tratamiento de Datos Personales (Ley 1581 de 2012, Decreto 1377 de 2013) | [politica-datos-v1.md](../../services/usuarios-service/src/modules/legal/textos/politica-datos-v1.md) | Cliente, técnico y admin | Primer ingreso y cada versión nueva |
| Autorización previa, expresa e informada | [autorizacion-datos-v1.md](../../services/usuarios-service/src/modules/legal/textos/autorizacion-datos-v1.md) | Cliente, técnico y admin | Primer ingreso y cada versión nueva; el admin deja además constancia presencial al dar de alta a un cliente |
| Plantilla de condiciones taller ↔ cliente | [condiciones-cliente-plantilla-v1.md](../../services/usuarios-service/src/modules/legal/textos/condiciones-cliente-plantilla-v1.md) | El cliente, las condiciones **que publica cada taller** a partir de la plantilla | Primera reserva en ese taller y cada versión nueva del taller |

Los textos viven dentro de `usuarios-service` porque es el servicio que los
sirve (`GET /legal/documentos/:tipo`) y los copia a la imagen al compilar.
En el panel se leen en `/legal/politica_datos`, `/legal/terminos_taller` y
`/legal/autorizacion_datos`, también sin sesión (enlaces en el login).

## Marcas en los borradores

- `⟦COMPLETAR: …⟧`: falta un dato del negocio (razón social, NIT, plazos,
  proveedores…).
- `⟦REVISIÓN LEGAL: …⟧`: una pregunta concreta para el abogado.
- `{{taller.nombre}}`, `{{politica.ventana_horas}}`…: solo en la plantilla de
  condiciones; se llenan solos con la configuración de cada taller.

El panel muestra las marcas resaltadas. Las condiciones de un taller **no se
pueden publicar** mientras tengan alguna.

## Versiones: cómo se publica un cambio

Cada aceptación guarda la versión y el SHA-256 del texto aceptado. Por eso:

1. **Una versión que alguien ya aceptó en producción no se edita nunca.** Se
   crea un archivo nuevo (`politica-datos-v2.md`) y se agrega al final de su
   lista en [`catalogo.ts`](../../services/usuarios-service/src/modules/legal/catalogo.ts).
2. El hash se calcula con
   `node services/usuarios-service/scripts/hash-textos-legales.js` y se anota
   en el catálogo. La prueba `catalogo.spec.ts` falla si un archivo no
   coincide con su hash.
3. Cuando el texto esté revisado, `borrador: false`. Una versión publicada no
   puede tener marcas (lo verifica la misma prueba). Mientras quede alguna
   vigente en borrador, `usuarios-service` lo avisa en el log al arrancar en
   producción.
4. Subir la versión en `VERSIONES_LEGALES` de
   [`e2e/fixtures/datos-de-prueba.ts`](../../e2e/fixtures/datos-de-prueba.ts).
5. Al desplegar, cada usuario ve la versión nueva en "Antes de continuar" y
   no entra al panel hasta aceptarla.

Las condiciones de cada taller se versionan solas: cada "Publicar" en
**Mi taller → Condiciones** crea la versión siguiente, inmutable, y los
clientes la aceptan en su próxima reserva (reservas-service rechaza la
reserva si no la aceptaron).

## Qué queda registrado

`aceptaciones_legales` (migración 018): usuario, documento, versión, SHA-256,
fecha, IP, navegador y canal (`web`, `app` o `presencial` con quién la
registró). La aplicación solo puede insertar: ni modificar ni borrar. Cada
usuario ve las suyas en **Mis datos**, con enlace al texto exacto que aceptó.

Las solicitudes del titular (exportación, rectificación, supresión) quedan en
`solicitudes_titular`.
