/**
 * DRAFT legal texts, adapted from common B2B SaaS templates. NOT reviewed by a lawyer. Before launch the owner must
 * fill the {{...}} values in site.config.ts (LEGAL) and have counsel review every page for the chosen jurisdiction.
 */
import { LEGAL } from "../site.config";
import type { Locale } from "../i18n";

export type LegalDoc = { title: string; intro: string; sections: { h: string; p: string[] }[] };
export type LegalSlug = "terms" | "privacy" | "refund";

const L = LEGAL;

const en: Record<LegalSlug, LegalDoc> = {
  terms: {
    title: "Terms of Service",
    intro: `These Terms govern access to and use of WS_DeskOS (the "Service"), provided by ${L.entity}, ${L.address} ("we", "us"). By using the Service you agree to these Terms on behalf of yourself and the organisation you represent ("Customer").`,
    sections: [
      { h: "1. The Service", p: ["WS_DeskOS is a hosted trading journal, risk monitoring and training platform for proprietary trading desks and traders. The Service analyses trade data that Customer makes available. It does not place, change or cancel orders and it is not a broker, an investment adviser or a trading signal service."] },
      { h: "2. Accounts and workspaces", p: ["Each desk receives a separate workspace. Customer is responsible for the users it invites, for keeping credentials confidential and for all activity in its workspace. Notify us promptly of any unauthorised use."] },
      { h: "3. Customer data", p: ["Customer keeps all rights to the data it or its users submit or connect (\"Customer Data\"). Customer grants us a limited licence to host, process and display Customer Data only to provide and support the Service. On request, and at the end of the agreement, we export or delete Customer Data as described in the Privacy Policy."] },
      { h: "4. Broker and reporting connections", p: ["Connections to brokers and reporting providers use read-only credentials supplied by Customer. Availability of third-party data depends on those providers; we are not responsible for their outages, delays or errors."] },
      { h: "5. Acceptable use", p: ["Customer will not misuse the Service, including by attempting to access other workspaces, interfering with its operation, reverse engineering it except where law allows, or using it in breach of applicable law or of a trading venue's or firm's rules."] },
      { h: "6. Fees", p: ["Fees, billing periods and payment terms are set out in the order form or invoice agreed with Customer. Unless stated otherwise, fees are payable in advance and exclusive of taxes."] },
      { h: "7. No financial advice", p: ["Alerts, analytics, estimates such as \"money saved\" and training content are informational. They are not investment advice and do not guarantee any trading result. Trading involves substantial risk of loss. Customer and its traders remain solely responsible for their trading decisions and for complying with their risk rules."] },
      { h: "8. Availability and changes", p: ["We aim for high availability but do not guarantee uninterrupted service. We may improve or change features; we will not materially reduce core functionality during a paid term without notice."] },
      { h: "9. Confidentiality and security", p: ["Each party will protect the other's confidential information with reasonable care. We maintain administrative, technical and organisational measures designed to protect Customer Data, including workspace isolation and access controls."] },
      { h: "10. Warranties and liability", p: ["The Service is provided \"as is\" to the extent permitted by law. To the maximum extent permitted by law, neither party is liable for indirect, incidental or consequential damages or lost profits, including trading losses, and our total liability is limited to the fees Customer paid in the twelve months before the claim."] },
      { h: "11. Term and termination", p: ["The agreement runs for the term in the order form and renews as stated there. Either party may terminate for material breach not cured within 30 days of notice. On termination access ends and Customer Data is handled as set out in section 3."] },
      { h: "12. Governing law", p: [`These Terms are governed by the laws of ${L.jurisdiction}. Disputes will be resolved in the courts of ${L.jurisdiction}, unless mandatory law provides otherwise.`] },
      { h: "13. Contact", p: [`Questions about these Terms: ${L.contactEmail}.`] },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: `This policy explains how ${L.entity} ("we") processes personal data on this website and in WS_DeskOS.`,
    sections: [
      { h: "1. Who is responsible", p: [`For the website and sales enquiries we are the controller. For trading data inside a desk's workspace, the desk is the controller and we process it on the desk's instructions as a processor. Contact: ${L.contactEmail}.`] },
      { h: "2. What we collect", p: ["Lead form: name, desk or company, number of traders, platform, work email, language and your message.", "Product: account details of invited users, trade and execution data connected by the desk, and usage logs needed to run and secure the Service.", "Website analytics: if enabled, privacy-friendly aggregate statistics without cookies or cross-site tracking."] },
      { h: "3. Why we use it", p: ["To answer your request and arrange a demo (our legitimate interest, or steps before a contract); to provide, secure and support the Service (contract); to meet legal obligations."] },
      { h: "4. Sharing", p: ["We do not sell personal data. We share it only with service providers that host or operate the Service for us (for example hosting and messaging providers), under contracts that protect it, or when the law requires."] },
      { h: "5. Retention", p: ["Lead form data is kept for up to 24 months after the last contact unless you become a customer. Workspace data is kept for the duration of the agreement and then exported or deleted on the desk's instruction."] },
      { h: "6. Security", p: ["Each desk has an isolated workspace with its own users and permissions. Broker connections are read-only. Access is limited to people who need it."] },
      { h: "7. Your rights", p: ["Depending on where you live you may have the right to access, correct, delete, restrict or port your data and to object to processing. Write to us to use them; you may also complain to your data protection authority."] },
      { h: "8. International transfers", p: ["Where data is transferred across borders we use appropriate safeguards required by applicable law."] },
      { h: "9. Changes", p: ["We will post any changes here and update the effective date."] },
    ],
  },
  refund: {
    title: "Refund Policy",
    intro: `This policy applies to fees paid to ${L.entity} for WS_DeskOS.`,
    sections: [
      { h: "1. Subscriptions", p: ["Fees are billed in advance for the period in the order form. You can cancel at any time; the cancellation takes effect at the end of the current billing period and you keep access until then."] },
      { h: "2. First payment", p: ["If the Service does not work for your desk, ask for a refund within 14 days of your first payment and we will refund that payment in full."] },
      { h: "3. Renewals and partial periods", p: ["Renewal payments and partially used periods are not refundable, except where the law requires or where we fail to provide the Service as agreed."] },
      { h: "4. Setup and integration work", p: ["Custom integration or onboarding work agreed separately is refundable only for work not yet performed."] },
      { h: "5. How to ask", p: [`Write to ${L.contactEmail} from the billing contact's email with the invoice number. Approved refunds are returned to the original payment method within 10 business days.`] },
    ],
  },
};

const es: Record<LegalSlug, LegalDoc> = {
  terms: {
    title: "Términos del servicio",
    intro: `Estos Términos regulan el acceso y uso de WS_DeskOS (el "Servicio"), prestado por ${L.entity}, ${L.address} ("nosotros"). Al usar el Servicio aceptas estos Términos en tu nombre y en el de la organización que representas ("Cliente"). En caso de discrepancia prevalece la versión en inglés.`,
    sections: [
      { h: "1. El Servicio", p: ["WS_DeskOS es una plataforma alojada de diario de trading, control de riesgo y formación para mesas de trading propietario y traders. Analiza los datos de operaciones que el Cliente pone a disposición. No envía, modifica ni cancela órdenes y no es un bróker, un asesor de inversiones ni un servicio de señales."] },
      { h: "2. Cuentas y espacios", p: ["Cada mesa recibe un espacio de trabajo separado. El Cliente es responsable de los usuarios que invita, de la confidencialidad de las credenciales y de toda la actividad en su espacio."] },
      { h: "3. Datos del Cliente", p: ["El Cliente conserva todos los derechos sobre sus datos. Nos concede una licencia limitada para alojarlos, procesarlos y mostrarlos solo para prestar el Servicio. A pedido, y al terminar el contrato, exportamos o borramos los datos según la Política de privacidad."] },
      { h: "4. Conexiones con brókers e informes", p: ["Las conexiones usan credenciales de solo lectura facilitadas por el Cliente. La disponibilidad de datos de terceros depende de esos proveedores."] },
      { h: "5. Uso aceptable", p: ["El Cliente no hará un uso indebido del Servicio, incluido intentar acceder a otros espacios, interferir con su funcionamiento o usarlo en contra de la ley o de las reglas de su firma o mercado."] },
      { h: "6. Tarifas", p: ["Las tarifas, periodos y condiciones de pago constan en la orden de compra o factura acordada. Salvo indicación contraria, se pagan por adelantado y sin impuestos incluidos."] },
      { h: "7. Sin asesoramiento financiero", p: ["Las alertas, la analítica, estimaciones como el \"dinero ahorrado\" y los contenidos de formación son informativos. No son asesoramiento de inversión ni garantizan resultados. El trading implica un riesgo sustancial de pérdida."] },
      { h: "8. Disponibilidad y cambios", p: ["Buscamos una alta disponibilidad pero no garantizamos un servicio ininterrumpido. Podemos mejorar o cambiar funciones sin reducir de forma sustancial las funciones principales durante un periodo pagado sin aviso."] },
      { h: "9. Confidencialidad y seguridad", p: ["Cada parte protegerá la información confidencial de la otra. Mantenemos medidas diseñadas para proteger los datos, incluido el aislamiento de espacios y controles de acceso."] },
      { h: "10. Garantías y responsabilidad", p: ["El Servicio se presta \"tal cual\" en la medida permitida por la ley. Ninguna parte responde por daños indirectos o lucro cesante, incluidas pérdidas de trading, y nuestra responsabilidad total se limita a las tarifas pagadas en los doce meses anteriores a la reclamación."] },
      { h: "11. Duración y terminación", p: ["El contrato dura el periodo de la orden de compra. Cualquiera de las partes puede terminarlo por incumplimiento grave no subsanado en 30 días."] },
      { h: "12. Ley aplicable", p: [`Estos Términos se rigen por las leyes de ${L.jurisdiction}.`] },
      { h: "13. Contacto", p: [`Preguntas sobre estos Términos: ${L.contactEmail}.`] },
    ],
  },
  privacy: {
    title: "Política de privacidad",
    intro: `Esta política explica cómo ${L.entity} ("nosotros") trata los datos personales en este sitio y en WS_DeskOS.`,
    sections: [
      { h: "1. Responsable", p: [`Para el sitio y las consultas comerciales somos responsables del tratamiento. Para los datos de trading dentro del espacio de una mesa, la mesa es la responsable y nosotros actuamos como encargados. Contacto: ${L.contactEmail}.`] },
      { h: "2. Qué recogemos", p: ["Formulario: nombre, mesa o empresa, número de traders, plataforma, correo de trabajo, idioma y tu mensaje.", "Producto: datos de cuenta de los usuarios invitados, datos de operaciones conectados por la mesa y registros de uso necesarios para operar y proteger el Servicio.", "Analítica del sitio: si está activada, estadísticas agregadas sin cookies ni seguimiento entre sitios."] },
      { h: "3. Para qué", p: ["Para responder a tu solicitud y organizar una demo; para prestar, proteger y dar soporte al Servicio; para cumplir obligaciones legales."] },
      { h: "4. Con quién compartimos", p: ["No vendemos datos personales. Solo los compartimos con proveedores que alojan u operan el Servicio, bajo contratos que los protegen, o cuando la ley lo exige."] },
      { h: "5. Conservación", p: ["Los datos del formulario se conservan hasta 24 meses tras el último contacto, salvo que pases a ser cliente. Los datos del espacio se conservan mientras dure el contrato y después se exportan o borran según indique la mesa."] },
      { h: "6. Seguridad", p: ["Cada mesa tiene un espacio aislado con sus propios usuarios y permisos. Las conexiones con brókers son de solo lectura."] },
      { h: "7. Tus derechos", p: ["Según dónde vivas puedes tener derecho a acceder, rectificar, borrar, limitar o portar tus datos y a oponerte al tratamiento. Escríbenos para ejercerlos."] },
      { h: "8. Transferencias internacionales", p: ["Cuando los datos se transfieren entre países usamos las garantías que exige la ley aplicable."] },
      { h: "9. Cambios", p: ["Publicaremos aquí cualquier cambio y actualizaremos la fecha de entrada en vigor."] },
    ],
  },
  refund: {
    title: "Política de reembolso",
    intro: `Esta política se aplica a las tarifas pagadas a ${L.entity} por WS_DeskOS.`,
    sections: [
      { h: "1. Suscripciones", p: ["Las tarifas se cobran por adelantado. Puedes cancelar en cualquier momento; la cancelación surte efecto al final del periodo en curso y mantienes el acceso hasta entonces."] },
      { h: "2. Primer pago", p: ["Si el Servicio no funciona para tu mesa, solicita el reembolso dentro de los 14 días posteriores a tu primer pago y lo devolveremos íntegramente."] },
      { h: "3. Renovaciones y periodos parciales", p: ["Las renovaciones y los periodos usados parcialmente no son reembolsables, salvo que la ley lo exija o no prestemos el Servicio según lo acordado."] },
      { h: "4. Trabajo de integración", p: ["El trabajo de integración o puesta en marcha acordado por separado solo es reembolsable por la parte aún no realizada."] },
      { h: "5. Cómo solicitarlo", p: [`Escribe a ${L.contactEmail} desde el correo de facturación con el número de factura. Los reembolsos aprobados se devuelven al medio de pago original en 10 días hábiles.`] },
    ],
  },
};

export const legalDoc = (locale: Locale, slug: LegalSlug): LegalDoc => (locale === "es" ? es : en)[slug];
