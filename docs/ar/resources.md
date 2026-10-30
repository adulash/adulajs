# تعريف الموارد

النسخة الإنجليزية: [Resource definitions](../resources.md) — المرجع الكامل المولَّد لخيارات `defineResource` (بالإنجليزية): [define-resource reference](../reference/define-resource.md)

المورد ملف واحد يستدعي `defineResource({ … })` في المجلد `app/modules/<module>/resources/`. التعريف هو مصدر الحقيقة ([ADR 045](../decisions/045-definition-as-source-of-truth.md)): حقوله تحدد أعمدة الجدول، والتحقق من كل عملية كتابة، والنماذج والصفحات المولَّدة، ووثيقة واجهة برمجة التطبيقات (API)، ومخطط الصلاحيات. لا يوجد مدقّق أو نموذج أو لقطة منفصلة يجب إبقاؤها متوافقة معه.

## خطوات العمل

1. **التوليد:** الأمر `node ace adula:resource <name> --module=<module>` يكتب التعريف وترحيل الإنشاء واختبار عقد الأمان (`tests/functional/<name>.spec.ts`). الخيار `--validator` يكتب أيضًا ملف مدقّق VineJS، و`--model` نموذج Lucid ومصنع بيانات، لاستخدامهما في شيفرتك أنت؛ AdulaJS لا يقرأ أيًّا منهما.
2. **الملء والترحيل:** املأ التسميات والحقول ثم شغّل `node ace migration:run`. ترحيل الإنشاء يحمل نسخة التعريف كما كانت لحظة التوليد.
3. **إضافة حقول لاحقًا:** بعد إضافة حقول أو تركيبات فريدة أو روابط `manyToMany` إلى جدول موجود، شغّل `node ace adula:resource:migration <name>`. يقارن الأمر التعريف بقاعدة البيانات الفعلية ويكتب `<module migrations>/<timestamp>_alter_<name>.ts`، وهو ترحيل إضافي يحمل القطع الناقصة فقط ويطبّقها بـ `alterResourceTable(db, name, addition)`. راجعه ثم شغّل `node ace migration:run`. قواعد مهمة:
   - العمود المضاف إلى جدول قد يحتوي صفوفًا لا يكون `NOT NULL` إلا إذا كان للحقل قيمة افتراضية.
   - العمود الذي تغيّر نوعه يُبلَّغ عنه ولا يُغيَّر تلقائيًا أبدًا؛ اكتب ترحيل توسيع ثم تقليص (expand/contract) بنفسك.
   - جعل حقل موجود `searchable` يحتاج ترحيلًا تكتبه بيدك، لأن متجه البحث المولَّد لا يتغير.
   - يطبّق الترحيل تغييرين مخففين: `dropNotNull` يزيل `NOT NULL` من عمود صار التعريف يسمح بأن يكون فارغًا (مثلًا حقل مطلوب أُضيف إليه `visibleWhen`؛ وقبل ذلك يفشل حفظه مخفيًا بالخطأ 422 `E_NOT_NULL`)، و`recreateUnique` يحذف ويعيد إنشاء الفهرس الفريد في جدول قابل للاعتماد (submittable) إن كان ما زال يحتسب المستندات الملغاة.
   - لا يضيف الترحيل `NOT NULL` إلى عمود موجود أبدًا.
4. **الفحص:** الأمر `node ace adula:doctor` يشغّل فحص `resources.schema` لكل مورد مسجّل، ويبلّغ عن: جدول ناقص، أعمدة ناقصة، أنواع أعمدة مختلفة، أعمدة `NOT NULL` يسمح التعريف بأن تكون فارغة، فهارس فريدة ناقصة، فهارس فريدة ما زالت تحتسب المستندات الملغاة، جداول ربط ناقصة. ويذكر أمر `adula:resource:migration` الذي يجب تشغيله.

الأمر `node ace adula:resource:snapshot <name>` مُهمَل. ما زال يعيد كتابة ترحيل إنشاء لم يُطبَّق بعد من التعريف الحالي، ويطبع تنبيهًا يشير إلى `adula:resource:migration`. فحص `resources.snapshots` لم يتغير (تسجّل اللقطة `visibleWhen` و`precision`/`scale` بعد حسابهما).

## مثال: مورد «الموردون» (suppliers)

تنبيه: كلمة «مورد» في هذه الصفحة تعني resource (نوع سجل)، أما «الموردون» في المثال فهم موردو البضائع (suppliers).

المثال لشركة مقاولات: لكل مورد رمز مثل `SUP-0042`، ونوع (محلي أو دولي)، والسجل التجاري مطلوب للمورد المحلي فقط.

```ts
import { defineResource } from 'adula'

export default defineResource({
  name: 'suppliers',
  label: { ar: 'الموردون' },
  recordLabel: { ar: 'مورد' },
  scoped: true,
  fields: {
    code: { type: 'string', label: { ar: 'رمز المورد' }, required: true, pattern: 'SUP-\\d{4}' },
    name: { type: 'string', label: { ar: 'اسم المورد' }, required: true, min: 2, max: 120 },
    email: { type: 'email', label: { ar: 'البريد الإلكتروني' } },
    kind: {
      type: 'enum',
      label: { ar: 'نوع المورد' },
      required: true,
      default: 'local',
      options: [
        { value: 'local', label: { ar: 'محلي' } },
        { value: 'international', label: { ar: 'دولي' } },
      ],
    },
    commercialRegister: {
      type: 'string',
      label: { ar: 'السجل التجاري' },
      required: true,
      pattern: '\\d{10}',
      visibleWhen: { kind: 'local' },
    },
    discountRate: { type: 'percent', label: { ar: 'نسبة الخصم' }, min: 0, max: 100, default: '0.00' },
    categories: { type: 'manyToMany', resource: 'supply_categories', label: { ar: 'فئات التوريد' } },
  },
  unique: [['orgUnitId', 'code']],
  list: ['code', 'name', 'kind'],
  form: ['code', 'name', 'kind', 'commercialRegister', 'email', 'discountRate', 'categories'],
  show: ['code', 'name', 'kind', 'commercialRegister', 'email', 'discountRate', 'categories'],
  actions: ['view', 'create', 'update', 'delete'],
})
```

في هذا المثال:

- `pattern: '\\d{10}'` يعني أن السجل التجاري عشرة أرقام بالضبط.
- `visibleWhen: { kind: 'local' }` يُخفي السجل التجاري حين يكون النوع «دولي»، ولا يُشترط حينها.
- `unique: [['orgUnitId', 'code']]` يمنع تكرار رمز المورد داخل الوحدة التنظيمية الواحدة.

بيانات الاختبار `apps/reference/tests/fixtures/modules/suppliers` تستخدم كل أنواع الحقول أدناه، ويختبرها `apps/reference/tests/functional/field_types.spec.ts`.

## مرجع الحقول

### أنواع الحقول

| النوع | العمود | القيمة المرسلة والمستلمة | خصائص خاصة بالنوع | مرشّح القائمة (`filters[key]=v`) |
|---|---|---|---|---|
| `string` | varchar(255) | نص بعد حذف المسافات من طرفيه | `min` و`max` (الطول)، `pattern`، `format: 'email' \| 'url' \| 'phone'` | مساواة |
| `text` | text | نص (لا تُحذف مسافاته) | `min`، `max`، `pattern` | مساواة |
| `email` | varchar(254) | عنوان بعد حذف المسافات وتحويله إلى حروف صغيرة | `min`، `max`، `pattern` | مساواة (بعد التوحيد) |
| `phone` | varchar(32) | `+` اختيارية ثم أرقام، من 7 إلى 15 رقمًا، مثل `+966551234567`؛ يقبل الإدخال المسافات و`-` و`.` و`()` والأرقام العربية الهندية (٠١٢...) | `min`، `max`، `pattern` | مساواة (بعد التوحيد) |
| `url` | varchar(2048) | رابط مطلق يبدأ بـ `http://` أو `https://`؛ تُرفض روابط `javascript:` و`data:` والروابط النسبية | `min`، `max`، `pattern` | مساواة |
| `integer` | integer | رقم | `min`، `max` | مساواة |
| `money` | bigint | نص يمثل عددًا صحيحًا بأصغر وحدة للعملة، مثل `"150000"` (أي 1500.00 ريال بالهللات) | `min` و`max` بأصغر وحدة (نص أو عدد صحيح آمن) | مساواة |
| `decimal` | numeric(precision, scale) | نص عشري فيه عدد `scale` من المنازل بالضبط، مثل `"12.50"`؛ تُقبل الأرقام والنصوص الأقصر وتُوحَّد. يُرفض رقم JSON قيمته المطلقة `Number.MAX_SAFE_INTEGER` أو أكثر، أو فيه أكثر من 15 رقمًا معنويًا (422 `unsafeNumber`): أرسل هذه القيم نصوصًا | `precision` (الافتراضي 18، من 1 إلى 1000)، `scale` (الافتراضي 2، من 0 إلى precision)، `min`، `max` | مساواة |
| `percent` | numeric(precision, scale) | مثل decimal؛ `"12.50"` تعني 12.5 % | مثل decimal، والافتراضي precision 7 وscale 2 | مساواة |
| `boolean` | boolean | قيمة منطقية | | مساواة |
| `date` | date | `YYYY-MM-DD` | | مساواة |
| `datetime` | timestamptz | نص ISO بتوقيت UTC مع الأجزاء من الألف من الثانية | | مساواة |
| `json` | jsonb | قيمة JSON | | لا يوجد |
| `enum` | varchar(255) | قيمة `value` لأحد الخيارات | `options` (مطلوب) | مساواة |
| `multiSelect` | jsonb | قيم خيارات غير مكررة بترتيب `options` | `options` (مطلوب)، `min` و`max` (العدد) | يحتوي القيمة؛ `null` = فارغ |
| `lookup` | varchar(255) | مفتاح من مجموعة القائمة المرجعية | `group` (مطلوب) | مساواة |
| `belongsTo` | مفتاح أجنبي integer (restrict) | معرّف السجل المرتبط | `resource` (مطلوب) | مساواة |
| `user` | مفتاح أجنبي integer إلى users (restrict) | معرّف المستخدم؛ ويراه القارئ بالشكل `{ id, fullName }` | | مساواة |
| `attachment` | integer (صف في attachments) | معرّف المرفق | `accept` (الامتدادات أو `'any'`)، `maxSize` (الافتراضي `'20mb'`) | مساواة |
| `hasMany` | لا يوجد (مورد فرعي) | الصفوف الفرعية | `resource` و`foreignKey` (مطلوبان)، `inline` | لا يوجد |
| `manyToMany` | لا يوجد: جدول ربط | مصفوفة تصاعدية بمعرّفات السجلات المرتبطة، و`[]` إن لم يوجد شيء | `resource` (مطلوب)، `table` | يحتوي معرّف الهدف؛ `null` = لا روابط |

`options` قائمة من `{ value: string; label: Label }`، والقيم غير مكررة وطول كل منها 255 حرفًا على الأكثر. تسميات الخيارات تتبع قواعد تسميات الحقول: `ar` مطلوبة، وبقية اللغات اختيارية.

`pattern` تعبير نمطي (regular expression) يُطابَق على القيمة كاملة بعد حذف المسافات من طرفيها: يُحاط بـ `^(?:…)$`، فـ `'\\d{10}'` تعني عشرة أرقام بالضبط. أطوال النصوص محدودة بالعمود (255 لـ string، و254 لـ email، و32 لـ phone، و2048 لـ url)؛ والقيمة الأطول تُرفض بالخطأ 422 بدل خطأ من قاعدة البيانات.

### حقول `manyToMany`

لا يخزّن حقل `manyToMany` عمودًا. جدول الربط هو `table`، أو `<owner table>_<field key in snake_case>`، وفيه العمودان `<owner>_id` و`<target>_id` (أو `related_id` حين يرتبط المورد بنفسه)، وكلاهما مفتاح أجنبي `RESTRICT`، والمفتاح الأساسي هو الزوج، مع فهرس على الهدف. الدالة `joinTable(owner, key, field)` تعيد هذه الأسماء.

- الكتابة تستبدل القائمة كلها (500 معرّف على الأكثر)، ويزامنها الخادم بالفرق داخل معاملة السجل.
- كل سجل يُربط حديثًا يجب أن يكون حيًّا (غير محذوف) ومسموحًا للمستخدم بعرضه (النطاق وقواعد الدور)، ويُفحص ذلك باستعلام واحد لكل حقل: والنتيجة 404 إن لم يتحقق في أي منها. الروابط التي لم تتغير لا يُعاد فحصها.
- التعديل بالنسخ (amend-by-copy) يربط السجلات نفسها في المستند وفي أسطره المضمَّنة المنسوخة (تُنسخ روابط السطر فقط إذا كان المستخدم يملك إنشاء ذلك الحقل، كبقية قيمه).

### خصائص مشتركة للحقول

| الخاصية | المعنى |
|---|---|
| `label` | تسمية مطلوبة من النوع `Label` (`{ ar, en?, … }`). |
| `required` | القيمة مطلوبة (عنصر واحد على الأقل في multiSelect وmanyToMany). العمود `NOT NULL` إلا إذا كان للحقل `visibleWhen`؛ والحقول الاختيارية أعمدة تقبل الفراغ. العمود الذي أُنشئ `NOT NULL` قبل إضافة `visibleWhen` يبقى كذلك حتى يزيله `adula:resource:migration` (ويبلّغ عنه الفحص)؛ وإلى ذلك الحين يفشل الحفظ الذي يخفي الحقل بالخطأ 422 `E_NOT_NULL` مع اسم الحقل. |
| `default` | تُطبَّق عند الإنشاء إذا لم يرسل الإدخال المفتاح (قبل التحقق)، وتُملأ مسبقًا في نموذج الإنشاء (`editor.defaults`)، وتصبح قيمة العمود الافتراضية للأنواع البسيطة. يجب أن تكون قيمة قياسية للنوع (`'0.00'` لنسبة بمنزلتين)؛ والمصفوفة لـ multiSelect فقط. غير مسموحة في belongsTo وuser وattachment وjson وhasMany وmanyToMany وحقول التسلسل. القيمة الافتراضية من التعريف، وليست كتابة من المستخدم. |
| `visibleWhen` | `{ sibling: value \| value[] }`: الحقل يسري فقط ما دام كل حقل شقيق مذكور يساوي القيمة أو إحدى القيم المذكورة (وفي شقيق multiSelect يجب أن يحتويها؛ و`null` تطابق القيمة الفارغة، وفي multiSelect عدم الاختيار). إذا كان الشقيق نفسه مخفيًا يُقيَّم الحقل كأن الشقيق فارغ، ويتكرر ذلك حتى تستقر النتيجة، على الخادم وفي النموذج المولَّد (والأسطر المضمَّنة كذلك). كل قيمة يجب أن تكون قيمة قياسية للحقل المتحكِّم (`'12.50'` لعشري بمنزلتين، وقيمة خيار لـ enum وmultiSelect)، ويفحص ذلك `defineResource`. ما دام الحقل لا يسري يُخفيه النموذج، ولا يُفرض `required`، ويخزّن الخادم `null` (أو قائمة فارغة لـ manyToMany) عند الإنشاء والتعديل مهما أُرسل، إلا أن التعديل يبقي القيمة أو الروابط المخزّنة لحقل لا يملك المستخدم كتابته. يجب أن يكون الأشقاء موجودين، ولا يكونون hasMany أو manyToMany أو json أو attachment. |
| `unique` | فهرس فريد جزئي على الصفوف الحية (`WHERE deleted_at IS NULL`). وفي المورد القابل للاعتماد لا تُحتسب المستندات الملغاة (`AND doc_status <> 2`)، فتحتفظ النسخة المعدّلة بقيمة أصلها الملغى. |
| `sortable` | مسموح في `sort`. لا يصلح لـ multiSelect وmanyToMany وhasMany. |
| `searchable` | جزء من متجه البحث النصي الكامل المولَّد. فقط لـ string وtext وemail وurl وphone وenum وlookup. |
| `filterable` | يُعرض مرشّحًا في القائمة. |
| `permissionLevel` | مستوى الوصول للحقل في قواعد الأدوار. |
| `sequence` | مفتاح تسلسل الترقيم؛ تُسند القيمة عند الإنشاء. |
| `column` | اسم العمود إن لم يكن هو المفتاح بصيغة snake_case. |

حقول multiSelect وmanyToMany وhasMany لا تكون `unique` ولا `sortable` ولا `searchable`، ولا تستخدمها شروط قواعد الأدوار.

شروط قواعد الأدوار (`$eq` و`$ne` و`$in` و`$lt` و`$gt` و`$like`؛ لا يوجد `$gte` ولا `$lte`) على حقول decimal وpercent تأخذ نصوصًا عشرية قياسية فيها عدد `scale` من المنازل بالضبط، وتقارن رقميًا. القواعد الترتيبية (`$lt` و`$gt`)، مثل قواعد money، تحتاج `buildAbility(rules, registry.all())` حتى تُعرف مخططات الحقول.

استيراد CSV يقرأ خلايا decimal وpercent مع فواصل الآلاف (`1,234.5`) والفاصلة العشرية العربية (`٫`)؛ أما الفاصلة الإنجليزية فاصلةً عشرية (`12,5`) فتُرفض. ولا يدعم استيراد CSV حقول multiSelect وmanyToMany بعد.

### خيارات المورد

| الخيار | المعنى |
|---|---|
| `name` | اسم الجدول: حروف إنجليزية صغيرة وأرقام و`_`. |
| `label` و`recordLabel` و`createLabel` | عنوان القائمة (بالجمع)، واسم السجل المفرد (فيصبح الزر «إضافة مورد»)، ونص زر الإنشاء كاملًا. |
| `scoped` | مطلوب. `true` يضيف `org_unit_id` والتقييد بالنطاق التنظيمي. و`scope: { from }` ينسخ الوحدة من حقل belongsTo أب مطلوب. |
| `fields` و`list` و`form` و`show` و`serialize` و`hidden` و`title` | تعريفات الحقول والمفاتيح التي يستخدمها كل عرض. `title` يحدد الحقل الذي يسمّي السجل في العلاقات وأدوات الاختيار والمهام والموافقات. |
| `unique` | تركيبات فريدة مركّبة، مثل `[['orgUnitId', 'code']]`: لكل تركيبة فهرس فريد جزئي على الصفوف الحية (ودون المستندات الملغاة في المورد القابل للاعتماد) يعدّ القيم الفارغة متساوية (`NULLS NOT DISTINCT`: صفان بالرمز نفسه وكلاهما فارغ في العضو الآخر يتعارضان). إضافة تركيبة عبر `adula:resource:migration` تفشل ما دامت صفوف حية تكررها، ومنها الأعضاء الفارغة: صحّح تلك الصفوف أولًا. تحتاج كل تركيبة حقلين مخزَّنين مختلفين أو أكثر؛ و`orgUnitId` مسموح في المورد المقيّد بالنطاق (رمز فريد لكل وحدة). |
| `submittable` و`version` | دورة المسودة/الاعتماد/الإلغاء/التعديل بالنسخ؛ والإصدارات المتفائلة لمنع الكتابة المتزامنة (مفعّلة افتراضيًا مع submittable). |
| `actions` | `view` و`create` و`update` و`delete`، و`submit` و`cancel` و`amend` في المورد القابل للاعتماد. |
| `hooks` | `beforeSave` و`afterSave`، داخل معاملة الكتابة. |
| `validator` | اختياري؛ راجع قسم التحقق أدناه. |
| `model` | اختياري ولا يُقرأ أبدًا: AdulaJS يحفظ البيانات عبر Knex. أبقه إن كانت شيفرتك تستخدم نموذج Lucid. |

يرفض `defineResource` التعريفات غير الصحيحة برسالة تذكر اسم الحقل: نمط غير صحيح، قيم خيارات مكررة، قيمة افتراضية غير قياسية، `visibleWhen` يذكر حقلًا غير موجود أو يستخدم قيمة غير قياسية، مفاتيح فريدة مجهولة. أما الخيار `customFields` فقد أُزيل ويُرفض.

## التحقق

دون `validator` تُفحص كل كتابة بمدقّق VineJS المشتق من حقول النموذج، `definitionValidator(resource)` (يُترجم مرة واحدة لكل تعريف). رسائله من دليل الرسائل (بالعربية افتراضيًا)، مثل `phone` و`decimalScale` و`decimalPrecision` و`relation`، إلى جانب قواعد VineJS مثل `regex` و`minLength` و`maxLength` و`email` و`url` و`min` و`max` و`in`. الأخطاء هي الخطأ المعتاد 422 `E_VALIDATION_ERROR` مع رسالة لكل حقل.

لإضافة قواعد أو تشديدها، وسّع المخطط المشتق بدل إعادة كتابة الحقول (هنا يحصل `name` على قاعدة أشد، ويبقى التعريف مطبَّقًا عند تخزين القيمة):

```ts
import vine from '@vinejs/vine'
import { defineResource, definitionSchema } from 'adula'

const fields = { /* … */ } as const
const base = { fields, form: ['code', 'name'] as const }

export default defineResource({
  // …
  ...base,
  validator: vine.create(
    vine.object({ ...definitionSchema(base), name: vine.string().trim().minLength(3) })
  ),
})
```

المدقّق المُعطى يحل محل المشتق. ومهما أعاد، ومهما كتب خطاف `beforeSave` أو `systemSave`، تُفحص كل قيمة مخزّنة مرة أخرى مقابل الحقل (الطول، النمط، الصيغة، الخيارات، المدى، منازل العشري ودقته): المخالفة خطأ 422 `E_FIELD_VALUE` برسالة عربية.

وهذا يشمل السجلات المحفوظة قبل وجود القيد: بعد إضافة `max` أو `pattern` إلى حقل، يفشل تعديل صف تخالف قيمته القيد بالخطأ 422 حتى تُصحَّح القيمة.

مخالفة التفرد، مفردة أو مركّبة، خطأ 409 `E_DUPLICATE` برسالة تذكر الحقول، مثل «هذه القيمة مستخدمة في سجل آخر: الوحدة التنظيمية، رمز المورد».

الحزمة `@vinejs/vine` (`^4.0.0`) اعتمادية نظيرة (peer dependency) لـ `adula`، وهي موجودة في كل تطبيق AdonisJS.
