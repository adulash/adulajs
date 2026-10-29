# دليل AdulaJS بالعربية

النسخة الإنجليزية: [Documentation map](../README.md)

AdulaJS إطار عمل لبناء الأنظمة الإدارية للشركات، والعربية لغته الأساسية. هذه الصفحات نسخة عربية من أهم أدلة الاستخدام. إذا اختلفت صفحة عربية عن نظيرتها الإنجليزية فالمرجع هو الصفحة الإنجليزية، وسجلات قرارات المعمارية (ADR) في [docs/decisions](../decisions/).

## المصطلحات

| المصطلح | المعنى | مثال |
|---|---|---|
| **النظام** (system) | نسخة واحدة منشورة من AdulaJS لكل شركة. | نظام «شركة الريادة للمقاولات» على خادمها الخاص. |
| **التطبيق** (application) | مجال عمل داخل النظام، يُبنى وحدةً (module) في المجلد `app/modules/<name>`. | تطبيق «طلبات الإجازة» وتطبيق «الصيانة» داخل نظام الشركة نفسه. |
| **المورد** (resource) | نوع سجل له حقول وقائمة ونموذج، يُعرَّف بملف `defineResource`. | مورد «طلبات الإجازة» أو مورد «الفحوصات» (inspections). |

تتشارك تطبيقات النظام الواحد المستخدمين والأدوار والهيكل التنظيمي والإشعارات وصندوق المهام، ويتكامل النظام مع برامج الشركة الأخرى عبر واجهة برمجة التطبيقات (API) والإشعارات الآلية الصادرة والواردة (webhooks) والاستيراد.

## الصفحات العربية

| السؤال | الصفحة العربية | الأصل الإنجليزي |
|---|---|---|
| كيف أنشئ نظامًا جديدًا أو أضيف AdulaJS إلى مشروع AdonisJS قائم؟ | [التثبيت](installation.md) | [Installation](../installation.md) |
| ماذا أفعل بعد أول تسجيل دخول؟ | [الإعداد الأولي](initial-setup.md) | [Initial setup](../initial-setup.md) |
| كيف أضيف تطبيقًا إلى النظام؟ | [التطبيقات](applications.md) | [Applications](../applications.md) |
| كيف أعرّف موردًا وحقوله وترحيلاته؟ | [تعريف الموارد](resources.md) | [Resource definitions](../resources.md) |
| كيف أتيح لغة أخرى غير العربية؟ | [اللغات](languages.md) | [Languages](../languages.md) |
| كيف يعمل تسجيل الدخول والدخول الموحّد والتحقق بخطوتين؟ | [المصادقة](authentication.md) | [Authentication](../authentication.md) |
| كيف أبني تطبيقًا كاملًا خطوة بخطوة؟ | [درس تطبيقي: طلبات الإجازة](tutorial-leave-requests.md) | [Tutorial](../tutorial-leave-requests.md) |

## صفحات متاحة بالإنجليزية فقط حاليًا

| السؤال | الصفحة |
|---|---|
| ما المرجع الكامل لخيارات `defineResource`؟ | [define-resource reference](../reference/define-resource.md) |
| كيف أرقّي نظامًا من الإصدار 1.x إلى 2.x؟ | [Upgrade to 2.0](../upgrade-2.0.md) |
| كيف أشغّل الشيفرة المصدرية وأختبرها؟ | [Development](../development.md) |
| كيف أستخدم التعاون والإشعارات الآلية ورموز API والاستيراد والطباعة وسير العمل؟ | [Business features](../business-features.md) |
| كيف أربط النظام ببرامج أخرى؟ | [Integration](../integration.md) |
| كيف أنشر النظام وأنسخه احتياطيًا وأستعيده؟ | [Operations](../operations.md) |
| ما الموجود اليوم ومدى اختباره؟ | [Implementation status](../implementation-status.md) |
| ما الذي لا يستطيعه AdulaJS بعد؟ | [GAPS](../../GAPS.md) |
| كيف يُنشر إصدار جديد؟ وما الإصدارات المنشورة؟ | [Releasing](../releasing.md)، [Releases](../releases.md) |
| ما عقود الحزم؟ | [Core README](../../packages/adula/README.md)، [UI README](../../packages/ui/README.md)، [Creator README](../../packages/create-adulajs/README.md) |
| لماذا اختير تصميم معيّن؟ | [قرارات المعمارية](../decisions/) |
| ما الذي تغيّر؟ | [CHANGELOG](../../CHANGELOG.md) |

الخطة المعتمدة الأصلية في [adulajs-plan.md](../../adulajs-plan.md)، وما قرره المالك لاحقًا في قرارات المعمارية يتقدم عليها حيث يغيّرها، ومن ذلك [إزالة التطبيقات التعليمية](../decisions/017-test-only-examples-and-release-gates.md).
