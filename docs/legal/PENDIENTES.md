# Sprint 23: pendientes fuera del código

El código del sprint está hecho: registro de aceptaciones, versiones que se
vuelven a pedir, condiciones por taller, derechos del titular. Lo que sigue
**no se resuelve programando**, y varias cosas bloquean la salida a
producción.

## 1. Revisión del abogado (bloqueante)

Entregarle los cuatro borradores (ver [README.md](README.md)). Cada
`⟦REVISIÓN LEGAL⟧` es una pregunta concreta:

**Términos y Condiciones TurnoPro ↔ taller**

- [ ] ¿Basta la aceptación por clic, o conviene firma electrónica
      (Decreto 2364 de 2012) para este contrato?
- [ ] Alcance real de la exclusión de responsabilidad solidaria frente al
      Estatuto Tributario, la Ley 1480 de 2011 y la Ley 2010 de 2019,
      sobre todo si TurnoPro llega a intervenir en el recaudo de anticipos
      (Sprint 24).
- [ ] Que el tope de responsabilidad (12 meses de tarifa) sea oponible, y
      si hace falta un tope distinto para incidentes de datos personales.
- [ ] Que el Anexo 1 cumple como contrato de transmisión, incluida la
      transmisión internacional (servidores y proveedores fuera de
      Colombia), y si se requiere declaración de conformidad ante la SIC.

**Política de Tratamiento y autorización**

- [ ] Cada taller es Responsable de los datos de sus clientes: ¿los
      talleres adoptan esta política como propia (con sus datos de
      contacto) o TurnoPro les entrega una plantilla aparte?
- [ ] ¿Nombrar a "el taller o talleres en los que reserve" identifica
      suficientemente al Responsable en la autorización? Hoy las
      condiciones de cada taller se aceptan en la primera reserva con él.
- [ ] Plazos de conservación de lo que se guarda al suprimir (artículo 28
      de la Ley 962 de 2005, artículo 632 del Estatuto Tributario) y cuándo
      se borra al vencer.
- [ ] Si TurnoPro o los talleres deben inscribirse en el Registro Nacional
      de Bases de Datos.
- [ ] Validar el alta en el mostrador: hoy el admin marca "el cliente
      autorizó" y queda como constancia presencial a su nombre. ¿Hace falta
      además un soporte firmado?
- [ ] Validar la supresión en autoservicio: es inmediata y conserva lo
      listado en la política (sección 6). ¿Hay que avisarle al taller?

**Plantilla de condiciones taller ↔ cliente**

- [ ] Anticipo: ¿arras de retracto (artículo 866 del Código de Comercio: si
      el taller se retracta, devuelve el doble) o confirmatorias? Ajustar
      la sección 2.
- [ ] **Derecho de retracto** (artículo 47 de la Ley 1480 de 2011): cómo
      aplica a una reserva con fecha cierta y cómo convive con la ventana
      de cancelación y los strikes. Hoy la plataforma **no** distingue el
      retracto: cancelar fuera de la ventana suma strike aunque sea dentro
      de los 5 días hábiles. Si el abogado dice que debe distinguirse, es
      un cambio de código (ver sección 5).
- [ ] Término de garantía supletorio y exclusiones (Decreto 735 de 2013).

## 2. Datos que tiene que definir TurnoPro

Son los `⟦COMPLETAR⟧` de los documentos de TurnoPro:

- [ ] Razón social, NIT, domicilio y dirección.
- [ ] Correo y teléfono para asuntos de datos personales, y el área o cargo
      que atiende las peticiones.
- [ ] Tarifas del servicio: plan, valor, periodicidad, mora, reajuste, IVA.
- [ ] Objetivo de disponibilidad (hoy 99,9 %), aviso de mantenimientos y el
      crédito si no se cumple.
- [ ] Plazos: aviso de cambios a los términos, preaviso de terminación,
      días para exportar al terminar, confidencialidad, aviso de incidentes
      al taller, traslado de solicitudes.
- [ ] Jurisdicción o centro de arbitraje.
- [ ] Proveedor y región de los servidores, y confirmar los subencargados
      (SendGrid, Twilio).
- [ ] Fecha de entrada en vigencia de la política.

## 3. Publicar las versiones definitivas

Cuando el abogado entregue los textos, seguir el procedimiento de
[README.md → Versiones](README.md#versiones-cómo-se-publica-un-cambio):
archivos v2, hash en el catálogo, `borrador: false`, versión en las
pruebas e2e. Es un cambio pequeño de código, pero **depende** de lo
anterior.

- [ ] Términos v2, política v2, autorización v2, plantilla de condiciones v2.

## 4. Operación y cumplimiento

- [ ] Crear el buzón de datos personales y un procedimiento para lo que
      llegue por correo: consultas en 10 días hábiles y reclamos en 15
      (artículos 14 y 15 de la Ley 1581 de 2012). El autoservicio de "Mis
      datos" no cubre, por ejemplo, el cambio de correo.
- [ ] Aceptar los acuerdos de tratamiento de datos (DPA) de los proveedores:
      nube, SendGrid, Twilio.
- [ ] Protocolo de incidentes de seguridad: quién avisa al taller y quién
      reporta a la SIC.
- [ ] **Avisar a los talleres antes del despliegue:** al entrar, cada admin
      tendrá que aceptar los términos y todos los usuarios la política y la
      autorización.
- [ ] Pedirle a cada taller que revise la plantilla con su abogado y
      publique sus condiciones en **Mi taller → Condiciones**. Hasta que no
      publique, sus clientes reservan sin aceptar condiciones.
- [ ] Explicarle al personal de mostrador la casilla de autorización al dar
      de alta a un cliente.
- [ ] En el despliegue, `TRUST_PROXY=1` (ya en `infra/k8s/10-configmap.yaml`)
      y **verificar** que la IP registrada en `aceptaciones_legales` es la
      del usuario y no la del balanceador.

## 5. Cambios de código que pueden salir de la revisión

No se hicieron porque dependen de una decisión legal:

- Tratar la cancelación dentro del plazo de retracto sin strike y con
  devolución total.
- Borrar lo conservado cuando venzan los plazos legales (tarea programada).
- Autorización separada y opcional para mensajes comerciales, si algún día
  se envían.
- Aviso al taller cuando un cliente suprime su cuenta.
- Hoy el panel no deja usar la aplicación sin aceptar, pero la API no lo
  exige salvo en la reserva (las condiciones del taller). Si el abogado
  pide que el bloqueo sea también en el servidor, es un guard en ambos
  servicios.
