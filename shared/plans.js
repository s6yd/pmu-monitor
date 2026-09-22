/* ═══════════ بيانات الخطط — المصدر الوحيد ═══════════
   PLANS · PLAN_ALT · REG_CAL · GUIDE. كانت مضمّنة في pmu-schedule.html،
   فالسيرفر ما يقدر يقرأها والصفحة وحدها تعرفها. نُقلت هنا حرفياً — بلا
   تغيير حرف واحد في البيانات — عشان يقرأها الاثنان من مكان واحد.

   يشتغل في Node وفي المتصفح بلا أي خطوة بناء:
     Node      → require('./shared/plans.js')  ترجع {PLANS,PLAN_ALT,REG_CAL,GUIDE}
     المتصفح   → <script src="/plans.js">      يعرّف window.PLANS وأخواتها

   السيرفر يخدم هذا الملف نفسه بايت ببايت على /plans.js، فما فيه نسختان
   تختلفان — نفس الخطأ اللي وقع في التقويم قبل ما يُوحَّد في /calendar.js.

   بيانات صافية: ولا دالة ولا إشارة لشيء خارج الملف. */
(function (root) {
'use strict';

/* ===== خطط 20 تخصص — PMU ===== */
const PLANS={

/* ═══ الخطة القديمة للميكانيكال (2024/2025) ═══
   الفرق عن الجديدة ثماني مواد مقابل ثماني، و43 مادة مشتركة:
     ALIS 1211/1212/2211/2212  ←→  ISLM 1221 + UNIV 1221/2221/2222
     COMM 1311/1312/2311/2312  ←→  COMM 1321/1322/2321/2322
   المتطلبات السابقة منقولة من PDF الخطة القديمة كما هي. */
MEEN_OLD:{name:'Mechanical Engineering',ar:'الهندسة الميكانيكية',total:139,
tech:{
'MEEN 4312':['GEEN 3311','MEEN 3322'],
'MEEN 4315':['MEEN 3322','MEEN 3333'],
'MEEN 4331':['MEEN 3322','MEEN 3333'],
'MEEN 4332':['MEEN 3322','MEEN 3333'],
'MEEN 4341':['MEEN 3322','MEEN 2311','MEEN 3333'],
'MEEN 4344':['MEEN 3311','MEEN 4393'],
'MEEN 4351':['MEEN 3395'],
'MEEN 4394':['MEEN 4392']},
sems:[
{id:'F1',label:'Freshman — الترم الأول',hrs:18,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Professional Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'GEEN 1211',n:'Intro to Engineering',h:2,p:[]}]},

{id:'F2',label:'Freshman — الترم الثاني',hrs:17,courses:[
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking & Problem Solving',h:2,p:[]},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']},
{c:'CHEM 1421',n:'Chemistry for Engineers I',h:4,p:[]},
{c:'GEEN 2311',n:'Engineering Mechanics I: Statics',h:3,p:['PHYS 1421']}]},

{id:'S1',label:'Sophomore — الترم الأول',hrs:18,courses:[
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[],min:30},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'UNIV 1213',n:'Leadership And Teamwork',h:2,p:['UNIV 1212']},
{c:'MATH 1324',n:'Calculus III',h:3,p:['MATH 1423']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']},
{c:'GEEN 2211',n:'Engineering Computing',h:2,p:['MATH 1423','GEEN 1211']},
{c:'MEEN 2312',n:'Engineering Mechanics II: Dynamics',h:3,p:['GEEN 2311']}]},

{id:'S2',label:'Sophomore — الترم الثاني',hrs:17,courses:[
{c:'MEEN 2311',n:'Materials Engineering',h:3,p:['GEEN 2311','CHEM 1421']},
{c:'GEEN 2313',n:'Thermodynamics I',h:3,p:['MATH 1423','CHEM 1421']},
{c:'MATH 2332',n:'Ordinary Differential Equations',h:3,p:['MATH 1324']},
{c:'MEEN 2313',n:'Solid Mechanics',h:3,p:['GEEN 2311']},
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 2312',n:'Technical & Professional Communication',h:3,p:['COMM 2311']}]},

{id:'J1',label:'Junior — الترم الأول',hrs:18,courses:[
{c:'MEEN 3394',n:'Computer Aided Design / Manufacturing',h:3,p:['MEEN 2313']},
{c:'GEEN 3311',n:'Intro to Fluid Mechanics',h:3,p:['GEEN 2313']},
{c:'MEEN 3311',n:'Manufacturing Processes',h:3,p:['MEEN 2311']},
{c:'MEEN 3101',n:'Machine Shop Practice and Safety',h:1,p:['MEEN 2313']},
{c:'MEEN 3322',n:'Thermodynamics II',h:3,p:['GEEN 2313']},
{c:'MEEN 3391',n:'Design Of Mechanisms',h:3,p:['MEEN 2312']},
{c:'ALIS 2211',n:'Linguistic Comm. Skills',h:2,p:[]}]},

{id:'J2',label:'Junior — الترم الثاني',hrs:16,courses:[
{c:'GEEN 3314',n:'Electric Circuits and Electronics',h:3,p:['PHYS 1422'],min:60},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111'],min:60},
{c:'MEEN 3432',n:'Computational Methods',h:4,p:['GEEN 2211','MATH 2332']},
{c:'MEEN 3333',n:'Heat Transfer',h:3,p:['GEEN 3311']},
{c:'MEEN 3395',n:'Mechanical Vibrations',h:3,p:['MEEN 3391']},
{c:'MEEN 3111',n:'Thermofluids & Energy Lab',h:1,p:['GEEN 3311']}]},

{id:'SU',label:'Summer — التدريب',hrs:3,courses:[
{c:'MEEN 3301',n:'Internship',h:3,p:[],min:90}]},

{id:'R1',label:'Senior — الترم الأول',hrs:18,courses:[
{c:'MEEN 4392',n:'Feedback Control',h:3,p:['MEEN 3395','MEEN 3432','GEEN 3314']},
{c:'MEEN 4393',n:'Machine Design',h:3,p:['MEEN 3394','MEEN 3311']},
{c:'MEEN 4396',n:'ME Senior Design I',h:3,p:['MEEN 3395','MEEN 3333'],min:90},
{c:'GEEN 4311',n:'Engineering Economy',h:3,p:['MEEN 3311']},
{c:'MEEN 4322',n:'Power Generation',h:3,p:['MEEN 3322','MEEN 3333']},
{c:'ELEC 1',n:'ME Technical Elective 1',h:3,p:[],el:1}]},

{id:'R2',label:'Senior — الترم الثاني',hrs:14,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'MEEN 4311',n:'Principles of HVAC',h:3,p:['MEEN 3322','MEEN 3333']},
{c:'MEEN 4397',n:'ME Senior Design II',h:3,p:['GEEN 4311','MEEN 4396']},
{c:'ELEC 3',n:'Social Science Elective',h:3,p:[],el:1},
{c:'ELEC 2',n:'ME Technical Elective 2',h:3,p:[],el:1}]}
]},

MEEN:{name:'Mechanical Engineering',ar:'الهندسة الميكانيكية',total:139,
tech:{
'MEEN 4312':['GEEN 3311','MEEN 3322'],
'MEEN 4315':['MEEN 3322','MEEN 3333'],
'MEEN 4331':['MEEN 3322','MEEN 3333'],
'MEEN 4332':['MEEN 3322','MEEN 3333'],
'MEEN 4341':['MEEN 3322','MEEN 2311'],
'MEEN 4344':['MEEN 3311','MEEN 4393'],
'MEEN 4351':['MEEN 3395'],
'MEEN 4394':['MEEN 4392']},
sems:[
{id:'F1',label:'Freshman — الترم الأول',hrs:18,courses:[
{c:'ISLM 1221',n:'Islamic Culture, Values & Society',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Life Style',h:1,p:[]},
{c:'COMM 1321',n:'Oral Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Professional Development',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'GEEN 1211',n:'Intro to Engineering',h:2,p:[]}]},

{id:'F2',label:'Freshman — الترم الثاني',hrs:17,courses:[
{c:'PHED 1112',n:'Healthy Behaviors & Management',h:1,p:[]},
{c:'GEEN 2311',n:'Engineering Mechanics I: Statics',h:3,p:['PHYS 1421']},
{c:'COMM 1322',n:'Written Communication',h:3,p:['COMM 1321']},
{c:'UNIV 1212',n:'Critical Thinking',h:2,p:[]},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']},
{c:'CHEM 1421',n:'Chemistry for Engineers I',h:4,p:[]}]},

{id:'S1',label:'Sophomore — الترم الأول',hrs:18,courses:[
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[],min:30},
{c:'COMM 2321',n:'Technical & Professional Comm.',h:3,p:['COMM 1322']},
{c:'GEEN 2211',n:'Engineering Computing',h:2,p:['MATH 1423','GEEN 1211']},
{c:'UNIV 1213',n:'Leadership & Teamwork',h:2,p:['UNIV 1212']},
{c:'MATH 1324',n:'Calculus III',h:3,p:['MATH 1423']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']},
{c:'MEEN 2312',n:'Engineering Mechanics II: Dynamics',h:3,p:['GEEN 2311','MATH 1423']}]},

{id:'S2',label:'Sophomore — الترم الثاني',hrs:17,courses:[
{c:'UNIV 1221',n:'Generative AI Prompt Eng. Basics',h:2,p:['UNIV 1211']},
{c:'COMM 2322',n:'Writing & Research',h:3,p:['COMM 2321']},
{c:'GEEN 2313',n:'Thermodynamics I',h:3,p:['MATH 1423','CHEM 1421']},
{c:'MEEN 2311',n:'Materials Engineering',h:3,p:['GEEN 2311','CHEM 1421']},
{c:'MATH 2332',n:'Differential Equations',h:3,p:['MATH 1324']},
{c:'MEEN 2313',n:'Solid Mechanics',h:3,p:['GEEN 2311']}]},

{id:'J1',label:'Junior — الترم الأول',hrs:18,courses:[
{c:'MEEN 3394',n:'Computer Aided Design',h:3,p:['MEEN 2313']},
{c:'MEEN 3311',n:'Manufacturing Processes',h:3,p:['MEEN 2311']},
{c:'MEEN 3322',n:'Thermodynamics II',h:3,p:['GEEN 2313']},
{c:'GEEN 3311',n:'Intro to Fluid Mechanics',h:3,p:['GEEN 2313']},
{c:'MEEN 3391',n:'Design of Mechanisms',h:3,p:['MEEN 2312']},
{c:'UNIV 2221',n:'Future Skills',h:2,p:['UNIV 1221']},
{c:'MEEN 3101',n:'Machine Shop Practice & Safety',h:1,p:['MEEN 2311']}]},

{id:'J2',label:'Junior — الترم الثاني',hrs:16,courses:[
{c:'GEEN 3314',n:'Electric Circuits & Electronics',h:3,p:['PHYS 1422'],min:60},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111'],min:60},
{c:'MEEN 3432',n:'Computational Methods',h:4,p:['GEEN 2211','MATH 2332']},
{c:'MEEN 3333',n:'Heat Transfer',h:3,p:['GEEN 3311']},
{c:'MEEN 3395',n:'Mechanical Vibration',h:3,p:['MEEN 3391']},
{c:'MEEN 3111',n:'Thermofluids & Energy Lab',h:1,p:['GEEN 3311']}]},

{id:'SU',label:'Summer — التدريب',hrs:3,courses:[
{c:'MEEN 3301',n:'Internship',h:3,p:[],min:90}]},

{id:'R1',label:'Senior — الترم الأول',hrs:18,courses:[
{c:'MEEN 4393',n:'Machine Design',h:3,p:['MEEN 3394','MEEN 3311']},
{c:'MEEN 4392',n:'Feedback Control',h:3,p:['MEEN 3395','MEEN 3432','GEEN 3314']},
{c:'GEEN 4311',n:'Engineering Economy',h:3,p:['MEEN 3311']},
{c:'MEEN 4322',n:'Power Generation',h:3,p:['MEEN 3322','MEEN 3333']},
{c:'MEEN 4396',n:'ME Senior Design I',h:3,p:['MEEN 3395','MEEN 3333'],min:90},
{c:'ELEC 1',n:'ME Technical Elective 1',h:3,p:[],el:1}]},

{id:'R2',label:'Senior — الترم الثاني',hrs:14,courses:[
{c:'MEEN 4397',n:'ME Senior Design II',h:3,p:['GEEN 4311','MEEN 4396']},
{c:'UNIV 2222',n:'Systems Thinking for Innovations',h:2,p:['UNIV 2221']},
{c:'MEEN 4311',n:'Principles of HVAC',h:3,p:['MEEN 3322','MEEN 3333']},
{c:'ELEC 2',n:'ME Technical Elective 2',h:3,p:[],el:1},
{c:'ELEC 3',n:'Social Science Elective',h:3,p:[],el:1}]}
]},

COSC:{name:'Computer Science',ar:'علوم الحاسب',total:137,tech:{},sems:[
{id:'F1',hrs:16,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'GEIT 1411',n:'Computer Science I',h:4,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]}]},

{id:'F2',hrs:19,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:['ALIS 1211']},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:['UNIV 1211']},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'GEIT 1412',n:'Computer Science II',h:4,p:['GEIT 1411']},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']}]},

{id:'S1',hrs:19,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:['ALIS 1212']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']},
{c:'MATH 1324',n:'Calculus III',h:3,p:['MATH 1423']},
{c:'GEIT 2421',n:'Data Structures',h:4,p:['GEIT 1412']},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:['PHED 1111']}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:['ALIS 2211']},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'GEIT 2331',n:'Mathematical Reasoning & Algorithmic Thinking',h:3,p:['GEIT 1412']},
{c:'COSC 2312',n:'Web Programming',h:3,p:['GEIT 1411']},
{c:'GEIT 2291',n:'Professional Ethics',h:2,p:[]},
{c:'MATH 2313',n:'Probability and Statistics',h:3,p:['MATH 1423']}]},

{id:'J1',hrs:18,courses:[
{c:'COSC 3332',n:'Discrete Structures and Combinatorial Analysis',h:3,p:['GEIT 2331']},
{c:'GEIT 3341',n:'Database I',h:3,p:['GEIT 1412']},
{c:'GEIT 3331',n:'Computer Organization',h:3,p:['GEIT 1412']},
{c:'MATH 3433',n:'Linear Algebra and Differential Equation',h:4,p:['MATH 1423']},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'COSC E1',n:'CS Elective I',h:3,p:[],el:1}]},

{id:'J2',hrs:17,courses:[
{c:'GEIT 3351',n:'Principles of Software Engineering',h:3,p:['GEIT 1412']},
{c:'COSC 3361',n:'Computer Networks',h:3,p:['MATH 2313','GEIT 2421']},
{c:'COSC 3351',n:'Algorithms',h:3,p:['GEIT 2421']},
{c:'COSC 3411',n:'Systems Programming',h:4,p:['GEIT 3331']},
{c:'COSC E2',n:'Natural Science Elective',h:4,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'GEIT 4361',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:16,courses:[
{c:'COSC 4361',n:'Operating Systems',h:3,p:['COSC 3411']},
{c:'COSC 4461',n:'Programming Languages',h:4,p:['COSC 3411']},
{c:'ASSE 4311',n:'Learning Outcome Assessment III — CS',h:3,p:['ASSE 3211']},
{c:'COSC E3',n:'CS Elective II',h:3,p:[],el:1},
{c:'COSC E4',n:'Social Science Elective I',h:3,p:[],el:1}]},

{id:'R2',hrs:12,courses:[
{c:'COSC 4362',n:'Artificial Intelligence',h:3,p:['COSC 3351']},
{c:'COSC 4363',n:'Theory of Computation',h:3,p:['COSC 3351','MATH 3433']},
{c:'COSC E5',n:'CS Elective III',h:3,p:[],el:1},
{c:'COSC E6',n:'Social Science Elective II',h:3,p:[],el:1}]}
]},

COEN:{name:'Computer Engineering',ar:'هندسة الحاسب',total:135,tech:{},sems:[
{id:'F1',hrs:16,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'GEIT 1411',n:'Computer Science I',h:4,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]}]},

{id:'F2',hrs:19,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:['ALIS 1211']},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:['UNIV 1211']},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'GEIT 1412',n:'Computer Science II',h:4,p:['GEIT 1411']},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']}]},

{id:'S1',hrs:19,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:['ALIS 1212']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']},
{c:'MATH 1324',n:'Calculus III',h:3,p:['MATH 1423']},
{c:'GEIT 2421',n:'Data Structures',h:4,p:['GEIT 1412']},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:['PHED 1111']}]},

{id:'S2',hrs:18,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:['ALIS 2211']},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'GEIT 2331',n:'Mathematical Reasoning & Algorithmic Thinking',h:3,p:['GEIT 1412']},
{c:'COEN 2411',n:'Circuits',h:4,p:['MATH 1423','PHYS 1422']},
{c:'GEIT 2291',n:'Professional Ethics',h:2,p:[]},
{c:'MATH 2313',n:'Probability and Statistics',h:3,p:['MATH 1423']}]},

{id:'J1',hrs:16,courses:[
{c:'GEIT 3341',n:'Database I',h:3,p:['GEIT 1412']},
{c:'GEIT 3331',n:'Computer Organization',h:3,p:['GEIT 1412']},
{c:'MATH 3433',n:'Linear Algebra and Differential Equation',h:4,p:['MATH 1423']},
{c:'COEN 3323',n:'Digital and Logic Design',h:3,p:['COEN 2411']},
{c:'COEN E1',n:'CE Elective I',h:3,p:[],el:1}]},

{id:'J2',hrs:15,courses:[
{c:'GEIT 3351',n:'Principles of Software Engineering',h:3,p:['GEIT 1412']},
{c:'COEN 3361',n:'Computer Networks',h:3,p:['MATH 2313','GEIT 2421']},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'COEN 3421',n:'Electronics',h:4,p:['COEN 2411']},
{c:'COEN E2',n:'CE Elective II',h:3,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'GEIT 4361',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:16,courses:[
{c:'COEN 4361',n:'Operating Systems',h:3,p:['GEIT 3331']},
{c:'ASSE 4311',n:'Learning Outcome Assessment III — CE',h:3,p:['ASSE 3211']},
{c:'COEN E3',n:'Natural Science Elective',h:4,p:[],el:1},
{c:'COEN E4',n:'CE Elective III',h:3,p:[],el:1},
{c:'COEN E5',n:'Social Science Elective I',h:3,p:[],el:1}]},

{id:'R2',hrs:13,courses:[
{c:'COEN 4413',n:'Embedded Systems',h:4,p:['COEN 4361','GEIT 3351']},
{c:'COEN 4322',n:'Digital Signal Processing',h:3,p:['COEN 3323','MATH 2313']},
{c:'COEN E6',n:'CE Elective IV',h:3,p:[],el:1},
{c:'COEN E7',n:'Social Science Elective II',h:3,p:[],el:1}]}
]},

SOEN:{name:'Software Engineering',ar:'هندسة البرمجيات',total:132,tech:{},sems:[
{id:'F1',hrs:16,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'GEIT 1411',n:'Computer Science I',h:4,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]}]},

{id:'F2',hrs:19,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:['ALIS 1211']},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:['UNIV 1211']},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']},
{c:'GEIT 1412',n:'Computer Science II',h:4,p:['GEIT 1411']},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]}]},

{id:'S1',hrs:19,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:['ALIS 1212']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']},
{c:'MATH 1324',n:'Calculus III',h:3,p:['MATH 1423']},
{c:'GEIT 2421',n:'Data Structures',h:4,p:['GEIT 1412']},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:['PHED 1111']}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:['ALIS 2211']},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'GEIT 2331',n:'Mathematical Reasoning & Algorithmic Thinking',h:3,p:['GEIT 1412']},
{c:'SOEN 2312',n:'Web Programming',h:3,p:['GEIT 1411']},
{c:'GEIT 2291',n:'Professional Ethics',h:2,p:[]},
{c:'SOEN E1',n:'Social Science Elective I',h:3,p:[],el:1}]},

{id:'J1',hrs:15,courses:[
{c:'GEIT 3341',n:'Database I',h:3,p:['GEIT 1412']},
{c:'GEIT 3331',n:'Computer Organization',h:3,p:['GEIT 1412']},
{c:'SOEN 2332',n:'Discrete Structure and Combinatorial Analysis',h:3,p:['GEIT 2331']},
{c:'GEIT 3351',n:'Principles of Software Engineering',h:3,p:['GEIT 1412']},
{c:'SOEN 3351',n:'Algorithms',h:3,p:['GEIT 2421']}]},

{id:'J2',hrs:14,courses:[
{c:'SOEN 3311',n:'Requirements Engineering',h:3,p:['GEIT 3351']},
{c:'SOEN 4361',n:'Operating Systems',h:3,p:['GEIT 3331']},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'SOEN 4371',n:'E-Commerce',h:3,p:['GEIT 3341','SOEN 2312']},
{c:'MATH 2313',n:'Probability and Statistics',h:3,p:['MATH 1423']}]},

{id:'SU',hrs:3,courses:[
{c:'GEIT 4361',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:17,courses:[
{c:'SOEN 4311',n:'Software Architecture and Design',h:3,p:['SOEN 3311']},
{c:'ASSE 4311',n:'Learning Outcome Assessment III — SE',h:3,p:['ASSE 3211']},
{c:'SOEN 4312',n:'Software Testing and Quality Assurance',h:3,p:['GEIT 3351']},
{c:'SOEN E2',n:'Natural Science Elective',h:4,p:[],el:1},
{c:'SOEN E3',n:'SE Elective I',h:4,p:[],el:1}]},

{id:'R2',hrs:12,courses:[
{c:'SOEN 4313',n:'Software Project Management',h:3,p:['GEIT 3351']},
{c:'SOEN E4',n:'CS / CE / IT Elective',h:3,p:[],el:1},
{c:'SOEN E5',n:'SE Elective II',h:3,p:[],el:1},
{c:'SOEN E6',n:'Social Science Elective II',h:3,p:[],el:1}]}
]},

CSEC:{name:'Cybersecurity',ar:'الأمن السيبراني',total:133,tech:{},sems:[
{id:'F1',hrs:18,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'GEIT 1411',n:'Computer Science I',h:4,p:[]},
{c:'CSEC 1311',n:'Intro to Cybersecurity',h:3,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]}]},

{id:'F2',hrs:18,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]},
{c:'GEIT 1412',n:'Computer Science II',h:4,p:['GEIT 1411']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]},
{c:'CSEC E1',n:'Social Science Elective I',h:3,p:[],el:1}]},

{id:'S1',hrs:18,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'GEIT 2421',n:'Data Structures',h:4,p:['GEIT 1412']},
{c:'CSEC 2431',n:'Network Management',h:4,p:['GEIT 1412']},
{c:'GEIT 2291',n:'Professional Ethics',h:2,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'GEIT 2331',n:'Mathematical Reasoning & Algorithmic Thinking',h:3,p:['GEIT 1412']},
{c:'CSEC 2331',n:'Digital Forensics',h:3,p:['GEIT 2291']},
{c:'GEIT 3331',n:'Computer Organization',h:3,p:['GEIT 1412']},
{c:'CSEC E2',n:'Social Science Elective II',h:3,p:[],el:1}]},

{id:'J1',hrs:15,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'GEIT 3341',n:'Database I',h:3,p:['GEIT 1412']},
{c:'CSEC 3431',n:'Network Security',h:4,p:['CSEC 2431']},
{c:'GEIT 3351',n:'Principles of Software Engineering',h:3,p:['GEIT 1412']},
{c:'CSEC E3',n:'CSEC Elective I',h:3,p:[],el:1}]},

{id:'J2',hrs:17,courses:[
{c:'CSEC 3352',n:'Secure Software Engineering',h:3,p:['GEIT 3351']},
{c:'CSEC 3432',n:'Cyber Operations',h:4,p:['CSEC 2431']},
{c:'CSEC 3354',n:'Introduction to Cryptography',h:3,p:['GEIT 2421']},
{c:'CSEC 3355',n:'Scripting Languages',h:3,p:['GEIT 1412']},
{c:'CSEC E4',n:'Natural Science Elective I',h:4,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'GEIT 4361',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:12,courses:[
{c:'CSEC 4361',n:'Operating Systems',h:3,p:['GEIT 3331']},
{c:'CSEC 4362',n:'Machine Learning',h:3,p:['GEIT 2421']},
{c:'ASSE 4311',n:'Learning Outcome Assessment III — CSEC',h:3,p:['ASSE 3211']},
{c:'CSEC E5',n:'CSEC Elective II',h:3,p:[],el:1}]},

{id:'R2',hrs:15,courses:[
{c:'CSEC 4471',n:'Vulnerability and Penetration Testing',h:4,p:['CSEC 3355']},
{c:'CSEC 4472',n:'Systems Security',h:4,p:['CSEC 4361']},
{c:'CSEC E6',n:'CSEC Elective III',h:3,p:[],el:1},
{c:'CSEC E7',n:'Natural Science Elective II',h:4,p:[],el:1}]}
]},

AINT:{name:'Artificial Intelligence',ar:'الذكاء الاصطناعي',total:132,tech:{},sems:[
{id:'F1',hrs:16,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'GEIT 1411',n:'Computer Science I',h:4,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]}]},

{id:'F2',hrs:19,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'GEIT 1412',n:'Computer Science II',h:4,p:['GEIT 1411']},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']}]},

{id:'S1',hrs:18,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']},
{c:'GEIT 2291',n:'Professional Ethics',h:2,p:[]},
{c:'GEIT 2421',n:'Data Structures',h:4,p:['GEIT 1412']},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]}]},

{id:'S2',hrs:19,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'GEIT 2331',n:'Mathematical Reasoning & Algorithmic Thinking',h:3,p:['GEIT 1412']},
{c:'AINT 2412',n:'Scripting Languages for AI',h:4,p:['GEIT 1412']},
{c:'AINT 2311',n:'Introduction to AI',h:3,p:['GEIT 2421']},
{c:'MATH 2313',n:'Probability and Statistics',h:3,p:['MATH 1423']}]},

{id:'J1',hrs:19,courses:[
{c:'AINT 3332',n:'Discrete Structures and Combinatorial Analysis',h:3,p:['GEIT 2331']},
{c:'GEIT 3341',n:'Database I',h:3,p:['GEIT 1412']},
{c:'AINT 3411',n:'Introduction to Machine Learning',h:4,p:['AINT 2412','MATH 2313']},
{c:'MATH 3433',n:'Linear Algebra and Differential Equation',h:4,p:['MATH 1423']},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'GEIT 3331',n:'Computer Organization',h:3,p:['GEIT 1412']}]},

{id:'J2',hrs:17,courses:[
{c:'GEIT 3351',n:'Principles of Software Engineering',h:3,p:['GEIT 1412']},
{c:'AINT 3421',n:'Deep Learning',h:4,p:['AINT 3411']},
{c:'AINT 3351',n:'Algorithms',h:3,p:['GEIT 2421']},
{c:'AINT E1',n:'AI Elective I',h:3,p:[],el:1},
{c:'AINT E2',n:'Natural Science Elective',h:4,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'GEIT 4361',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:12,courses:[
{c:'AINT 4373',n:'Computer Vision',h:3,p:['MATH 3433']},
{c:'ASSE 4311',n:'Learning Outcome Assessment III — AI',h:3,p:['ASSE 3211']},
{c:'AINT E3',n:'Social Science Elective I',h:3,p:[],el:1},
{c:'AINT E4',n:'AI Elective II',h:3,p:[],el:1}]},

{id:'R2',hrs:9,courses:[
{c:'AINT E5',n:'AI Elective III',h:3,p:[],el:1},
{c:'AINT E6',n:'Social Science Elective II',h:3,p:[],el:1},
{c:'AINT E7',n:'AI Elective IV',h:3,p:[],el:1}]}
]},

ITAP:{name:'Information Technology',ar:'تقنية المعلومات',total:132,tech:{},sems:[
{id:'F1',hrs:18,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'ITAP 1311',n:'Intro to IT',h:3,p:[]},
{c:'GEIT 1411',n:'Computer Science I',h:4,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]}]},

{id:'F2',hrs:15,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:['ALIS 1211']},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:['UNIV 1211']},
{c:'MATH 1312',n:'Calculus for Business',h:3,p:['MATH 1311']},
{c:'GEIT 1412',n:'Computer Science II',h:4,p:['GEIT 1411']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:['PHED 1111']}]},

{id:'S1',hrs:18,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:['ALIS 1212']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'GEIT 2421',n:'Data Structures',h:4,p:['GEIT 1412']},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]},
{c:'ITAP E1',n:'Social Science Elective I',h:3,p:[],el:1}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:['ALIS 2211']},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ITAP 2312',n:'Web Programming',h:3,p:['GEIT 1411']},
{c:'GEIT 2291',n:'Professional Ethics',h:2,p:[]},
{c:'GEIT 2331',n:'Mathematical Reasoning & Algorithmic Thinking',h:3,p:['GEIT 1412']},
{c:'ITAP 2431',n:'Network Management',h:4,p:['GEIT 1412']}]},

{id:'J1',hrs:18,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'GEIT 3341',n:'Database I',h:3,p:['GEIT 1412']},
{c:'ITAP 3431',n:'Network Security',h:4,p:['ITAP 2431']},
{c:'GEIT 3331',n:'Computer Organization',h:3,p:['GEIT 1412']},
{c:'ITAP 3313',n:'User Interface Development',h:3,p:['GEIT 1412','ITAP 2312']},
{c:'ITAP E2',n:'IT Elective I',h:3,p:[],el:1}]},

{id:'J2',hrs:17,courses:[
{c:'ITAP 3471',n:'Web Server Administration',h:4,p:['ITAP 2312']},
{c:'ITAP 3411',n:'Systems Programming',h:4,p:['GEIT 3331']},
{c:'ITAP 3383',n:'Enterprise Resource Planning Systems',h:3,p:['GEIT 3341','GEIT 1412']},
{c:'GEIT 3351',n:'Principles of Software Engineering',h:3,p:['GEIT 1412']},
{c:'ITAP 3382',n:'Business Intelligence',h:3,p:['GEIT 3341']}]},

{id:'SU',hrs:3,courses:[
{c:'GEIT 4361',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:13,courses:[
{c:'ASSE 4311',n:'Learning Outcome Assessment III — IT',h:3,p:['ASSE 3211']},
{c:'ITAP 4371',n:'e-Commerce',h:3,p:['GEIT 3341','ITAP 2312']},
{c:'ITAP E3',n:'IT Elective II',h:3,p:[],el:1},
{c:'ITAP E4',n:'Natural Science Elective I',h:4,p:[],el:1}]},

{id:'R2',hrs:13,courses:[
{c:'ITAP 4316',n:'Introduction to Project Management',h:3,p:['GEIT 3351']},
{c:'ITAP E5',n:'IT Elective III',h:3,p:[],el:1},
{c:'ITAP E6',n:'Social Science Elective II',h:3,p:[],el:1},
{c:'ITAP E7',n:'Natural Science Elective II',h:4,p:[],el:1}]}
]},

CVEN:{name:'Civil Engineering',ar:'الهندسة المدنية',total:139,tech:{},sems:[
{id:'F1',hrs:18,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'GEEN 1211',n:'Intro to Engineering',h:2,p:[]}]},

{id:'F2',hrs:17,courses:[
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']},
{c:'CHEM 1421',n:'Chemistry for Engineers I',h:4,p:[]},
{c:'GEEN 2311',n:'Engineering Mechanics I: Statics',h:3,p:['PHYS 1421']}]},

{id:'S1',hrs:18,courses:[
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:[]},
{c:'MATH 1324',n:'Calculus III',h:3,p:['MATH 1423']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']},
{c:'GEEN 2211',n:'Engineering Computing',h:2,p:['MATH 1423']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'MEEN 2312',n:'Engineering Mechanics II: Dynamics',h:3,p:['GEEN 2311']}]},

{id:'S2',hrs:17,courses:[
{c:'CVEN 2311',n:'CAD for Civil Engineering',h:3,p:['MATH 1324']},
{c:'GEEN 2313',n:'Thermodynamics I',h:3,p:['MATH 1324','CHEM 1421']},
{c:'MATH 2332',n:'Ordinary Differential Equations',h:3,p:['MATH 1324']},
{c:'MEEN 2313',n:'Solid Mechanics',h:3,p:['GEEN 2311','MATH 1324']},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]}]},

{id:'J1',hrs:17,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'GEEN 3311',n:'Intro to Fluid Mechanics',h:3,p:['GEEN 2313']},
{c:'CVEN 3322',n:'Materials in Civil Engineering',h:3,p:['MEEN 2313']},
{c:'CVEN 3311',n:'Structural Analysis',h:3,p:['MEEN 2313']},
{c:'CVEN 3323',n:'Engineering Geology',h:3,p:['GEEN 2313']},
{c:'CVEN 3341',n:'Engineering Measurement',h:3,p:['CVEN 2311']}]},

{id:'J2',hrs:17,courses:[
{c:'CVEN 3331',n:'Environmental Engineering Fundamental',h:3,p:['GEEN 3311']},
{c:'CVEN 3332',n:'Hydraulic Engineering',h:3,p:['GEEN 3311']},
{c:'CVEN 3343',n:'Engineering Probability & Statistics',h:3,p:['MATH 1324']},
{c:'CVEN 3312',n:'Reinforced Concrete Design',h:3,p:['CVEN 3311']},
{c:'CVEN 3344',n:'Sustainable Engineering',h:3,p:['CVEN 3322']},
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]}]},

{id:'SU',hrs:3,courses:[
{c:'CVEN 3301',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:18,courses:[
{c:'CVEN 4313',n:'Design of Steel Structures',h:3,p:['MEEN 2313','CVEN 3312']},
{c:'CVEN 4323',n:'Intro to Geotechnical Engineering',h:3,p:['CVEN 3322','CVEN 3323']},
{c:'CVEN 4396',n:'Civil Engineering Senior Design I',h:3,p:['CVEN 3301']},
{c:'GEEN 4311',n:'Engineering Economy',h:3,p:[]},
{c:'CVEN 4342',n:'Transportation Engineering',h:3,p:['CVEN 3341']},
{c:'CVEN E1',n:'CE Technical Elective I',h:3,p:[],el:1}]},

{id:'R2',hrs:14,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'CVEN 4314',n:'Construction Management',h:3,p:['GEEN 4311']},
{c:'CVEN 4397',n:'Civil Engineering Senior Design II',h:3,p:['CVEN 4396','GEEN 4311']},
{c:'CVEN E2',n:'CE Technical Elective II',h:3,p:[],el:1},
{c:'CVEN E3',n:'Social Science Elective',h:3,p:[],el:1}]}
]},

CHEN:{name:'Chemical Engineering',ar:'الهندسة الكيميائية',total:139,tech:{},sems:[
{id:'F1',hrs:19,courses:[
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'CHEM 1421',n:'Chemistry for Engineers I',h:4,p:[]},
{c:'GEEN 1211',n:'Intro to Engineering',h:2,p:[]}]},

{id:'F2',hrs:17,courses:[
{c:'ALIS 1211',n:'Arabic and Islamic Studies',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']},
{c:'CHEM 1422',n:'Chemistry for Engineers II',h:4,p:['CHEM 1421']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]}]},

{id:'S1',hrs:17,courses:[
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'MATH 1324',n:'Calculus III',h:3,p:['MATH 1423']},
{c:'CHEN 2391',n:'Organic Chemistry',h:3,p:['CHEM 1422']},
{c:'GEEN 2211',n:'Engineering Computing',h:2,p:['MATH 1423']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'CHEN 2311',n:'Principles of Chemical Engineering',h:3,p:['PHYS 1421','MATH 1422']}]},

{id:'S2',hrs:18,courses:[
{c:'MEEN 2311',n:'Materials Engineering',h:3,p:['CHEM 1421']},
{c:'GEEN 2313',n:'Thermodynamics I',h:3,p:['MATH 1324','CHEM 1421']},
{c:'MATH 2332',n:'Ordinary Differential Equations',h:3,p:['MATH 1324']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']},
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']}]},

{id:'J1',hrs:16,courses:[
{c:'GEEN 3314',n:'Electric Circuits and Electronics',h:3,p:['PHYS 1422']},
{c:'GEEN 3311',n:'Intro to Fluid Mechanics',h:3,p:['GEEN 2313']},
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'CHEN 3313',n:'Biology',h:3,p:['CHEN 2391']},
{c:'CHEN 3315',n:'Physical Chemistry',h:3,p:['CHEM 1422']},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']}]},

{id:'J2',hrs:17,courses:[
{c:'CHEN 3494',n:'Separation Process',h:4,p:['GEEN 3311','CHEN 2311','CHEN 3315']},
{c:'CHEN E1',n:'Social Science Elective',h:3,p:[],el:1},
{c:'CVEN 4344',n:'Engineering Probability & Statistics',h:3,p:['MATH 2332']},
{c:'MEEN 3333',n:'Heat Transfer',h:3,p:['GEEN 3311']},
{c:'CHEN 3322',n:'Chemical Engineering Thermodynamics II',h:3,p:['CHEN 3315','GEEN 3311']},
{c:'MEEN 3111',n:'Thermofluids & Energy Lab',h:1,p:['GEEN 3311']}]},

{id:'SU',hrs:3,courses:[
{c:'CHEN 3301',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:17,courses:[
{c:'CHEN 4492',n:'Process Control',h:4,p:['CHEN 3494','MEEN 3333']},
{c:'CHEN 4493',n:'Reaction Engineering',h:4,p:['CHEN 3494','CHEN 3322']},
{c:'CHEN 4320',n:'Process Simulation',h:3,p:['CHEN 3494','MEEN 3333']},
{c:'CHEN 4396',n:'Chemical Eng. Senior Design I',h:3,p:['CHEN 3301','CHEN 3494']},
{c:'CHEN E2',n:'Chem Technical Elective I',h:3,p:[],el:1}]},

{id:'R2',hrs:15,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'CHEN 4422',n:'Plant Design',h:4,p:['CHEN 4320']},
{c:'CHEN 4397',n:'Chemical Eng. Senior Design II',h:3,p:['CHEN 4396']},
{c:'GEEN 4311',n:'Engineering Economy',h:3,p:[]},
{c:'CHEN E3',n:'Chem Technical Elective II',h:3,p:[],el:1}]}
]},

EEEN:{name:'Electrical Engineering',ar:'الهندسة الكهربائية',total:139,tech:{},sems:[
{id:'F1',hrs:17,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'GEEN 1211',n:'Intro to Engineering',h:2,p:[]}]},

{id:'F2',hrs:17,courses:[
{c:'EEEN E1',n:'Social Science Elective',h:3,p:[],el:1},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']},
{c:'PHYS 1422',n:'Physics for Engineers II',h:4,p:['PHYS 1421','MATH 1422']}]},

{id:'S1',hrs:17,courses:[
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'EEEN 2411',n:'Circuits I',h:4,p:['MATH 1423','PHYS 1422']},
{c:'MATH 1324',n:'Calculus III',h:3,p:['MATH 1423']},
{c:'CHEM 1421',n:'Chemistry for Engineers I',h:4,p:[]},
{c:'GEEN 2211',n:'Engineering Computing',h:2,p:['MATH 1423']}]},

{id:'S2',hrs:16,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:[]},
{c:'GEEN 2310',n:'Applied Linear Algebra for Engineers',h:3,p:[]},
{c:'MATH 2332',n:'Ordinary Differential Equations',h:3,p:['MATH 1324']},
{c:'EEEN 2312',n:'Circuits II',h:3,p:['EEEN 2411']}]},

{id:'J1',hrs:17,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'EEEN 3392',n:'Advanced Applied Mathematics',h:3,p:['GEEN 2310','MATH 2332']},
{c:'EEEN 3361',n:'Electromagnetic Fields & Waves',h:3,p:['EEEN 2411']},
{c:'EEEN 3421',n:'Electronics I',h:4,p:['EEEN 2411']},
{c:'EEEN 3331',n:'Digital Systems',h:3,p:['EEEN 2411']},
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]}]},

{id:'J2',hrs:18,courses:[
{c:'EEEN 3422',n:'Electronics II',h:4,p:['EEEN 3421']},
{c:'EEEN 3432',n:'Microcontroller Systems',h:4,p:['EEEN 3331','GEEN 2211']},
{c:'EEEN 3341',n:'Signals and Systems',h:3,p:['EEEN 2312','EEEN 3392']},
{c:'EEEN 3461',n:'Electric Machinery',h:4,p:['EEEN 3361']},
{c:'EEEN 3391',n:'Probability & Random Signal Analysis',h:3,p:['EEEN 2312','EEEN 3392']}]},

{id:'SU',hrs:3,courses:[
{c:'EEEN 3301',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:17,courses:[
{c:'EEEN 4440',n:'Communication Systems',h:4,p:['EEEN 3391','EEEN 3341']},
{c:'EEEN 4393',n:'Electrical Eng. Senior Design I',h:3,p:['EEEN 3301','EEEN 3432']},
{c:'EEEN 4423',n:'Sensors & Instrumentation',h:4,p:['EEEN 3422']},
{c:'EEEN E2',n:'EE Technical Elective I',h:3,p:[],el:1},
{c:'GEEN 4311',n:'Engineering Economy',h:3,p:[]}]},

{id:'R2',hrs:17,courses:[
{c:'EEEN 4394',n:'Electrical Eng. Senior Design II',h:3,p:['GEEN 4311','EEEN 4393']},
{c:'EEEN 4451',n:'Automatic Control Systems',h:4,p:['EEEN 3341','EEEN 3331']},
{c:'EEEN E3',n:'EE Technical Elective II',h:3,p:[],el:1},
{c:'EEEN 4424',n:'Power Electronics',h:4,p:['EEEN 3422']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]},
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]}]}
]},

ARCH:{name:'Architecture',ar:'العمارة',total:163,tech:{},sems:[
{id:'F1',hrs:15,courses:[
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1422',n:'Calculus I',h:4,p:[]},
{c:'COAD 1311',n:'Design Studio I — Fundamentals',h:3,p:[]},
{c:'COAD 1312',n:'Hand Drawing and Rendering Techniques',h:3,p:[]}]},

{id:'F2',hrs:16,courses:[
{c:'ARCH E1',n:'Social Science Elective I',h:3,p:[],el:1},
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:['UNIV 1211']},
{c:'COAD 1313',n:'Design Studio II — Fundamentals',h:3,p:['COAD 1311','COAD 1312']},
{c:'COAD 1314',n:'Construction Documents and Detail Drawings',h:3,p:['COAD 1311']}]},

{id:'S1',hrs:17,courses:[
{c:'MATH 1423',n:'Calculus II',h:4,p:['MATH 1422']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COAD 2333',n:'Environmental Psychology for Design',h:3,p:['COAD 1313']},
{c:'ARCH 2341',n:'Principles of Design with Climate',h:3,p:[]},
{c:'ARCH 2421',n:'Design Studio III — Architectural Design',h:4,p:['COAD 1313']},
{c:'COAD 2251',n:'Digital Design I: 2D',h:2,p:['COAD 1314']}]},

{id:'S2',hrs:18,courses:[
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'PHYS 1421',n:'Physics for Engineers I',h:4,p:[]},
{c:'ARCH 2342',n:'Materials and Methods',h:3,p:[]},
{c:'ARCH 2422',n:'Design Studio IV — Integrated',h:4,p:['ARCH 2421']},
{c:'COAD 2252',n:'Digital Design II: 3D',h:2,p:['COAD 2251']}]},

{id:'J1',hrs:16,courses:[
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'COAD 3341',n:'Built World Design History and Theory I',h:3,p:['COAD 2333']},
{c:'COAD 3353',n:'Digital Design III: BIM',h:3,p:['COAD 2252']},
{c:'ARCH 3523',n:'Design Studio V — Architectural Design',h:5,p:['ARCH 2422']}]},

{id:'J2',hrs:16,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:['ALIS 1211']},
{c:'ARCH 3343',n:'Principles of Structural Systems',h:3,p:['ARCH 2342']},
{c:'COAD 3342',n:'Built World Design History and Theory II',h:3,p:['COAD 3341']},
{c:'COAD 3322',n:'Building Codes and Universal Design',h:3,p:['ARCH 2342']},
{c:'ARCH 3524',n:'Design Studio VI — Integrated',h:5,p:['ARCH 3523']}]},

{id:'R1',hrs:15,courses:[
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'ARCH 4344',n:'Introduction to Environmental Systems',h:3,p:['ARCH 2341']},
{c:'ARCH 4354',n:'Simulation and Optimization',h:3,p:['MATH 1423','COAD 3353','ARCH 3343']},
{c:'ARCH E2',n:'Professional Elective I',h:3,p:[],el:1},
{c:'ARCH 4525',n:'Design Studio VII — Architectural Design',h:5,p:['ARCH 3524','COAD 3322']}]},

{id:'R2',hrs:17,courses:[
{c:'ARCH 4361',n:'Preparing the Project Brief',h:3,p:['UNIV 1213','COAD 2333']},
{c:'ARCH 4362',n:'Construction Process and Building Economics',h:3,p:['ARCH 3343']},
{c:'ARCH 4345',n:'Architectural Structures',h:3,p:['MATH 1423','ARCH 4354']},
{c:'ARCH 4346',n:'Integrated Environmental Systems',h:3,p:['ARCH 4344']},
{c:'ARCH 4526',n:'Design Studio VIII — Integrated',h:5,p:['ARCH 4525']}]},

{id:'SU',hrs:3,courses:[
{c:'ARCH 4365',n:'Internship',h:3,p:[]}]},

{id:'T1',hrs:15,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:['ALIS 1212']},
{c:'ARCH E3',n:'Social Science Elective II',h:3,p:[],el:1},
{c:'CHEM 1411',n:'Introductory Chemistry',h:4,p:[]},
{c:'ARCH E4',n:'Professional Elective II',h:3,p:[],el:1},
{c:'ARCH 5327',n:'Design Studio IX — Capstone Programming',h:3,p:['ARCH 4365','ARCH 4526']}]},

{id:'T2',hrs:15,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:['ALIS 2211']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:['PHED 1111']},
{c:'ARCH 5363',n:'Professional Practice and Ethics',h:3,p:['ARCH 4526']},
{c:'ARCH E5',n:'Professional Elective III',h:3,p:[],el:1},
{c:'ARCH 5628',n:'Design Studio X — Architectural Capstone',h:6,p:['ARCH 5327']}]}
]},

IDES:{name:'Interior Design',ar:'التصميم الداخلي',total:126,tech:{},sems:[
{id:'F1',hrs:15,courses:[
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'COAD 1311',n:'Design Studio I — Fundamentals',h:3,p:[]},
{c:'COAD 1312',n:'Hand Drawing and Rendering Techniques',h:3,p:[]}]},

{id:'F2',hrs:15,courses:[
{c:'IDES E1',n:'Social Science Elective I',h:3,p:[],el:1},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:['PHED 1111']},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:['UNIV 1211']},
{c:'COAD 1313',n:'Design Studio II — Fundamentals',h:3,p:['COAD 1311','COAD 1312']},
{c:'COAD 1314',n:'Construction Documents and Detail Drawings',h:3,p:['COAD 1311']}]},

{id:'S1',hrs:16,courses:[
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'MATH 1312',n:'Calculus for Business',h:3,p:['MATH 1311']},
{c:'IDES 2332',n:'Materials for Interior Design',h:3,p:['COAD 1313']},
{c:'IDES 2311',n:'Interior Design III — Residential Studio',h:3,p:['COAD 1313','COAD 1314']},
{c:'COAD 2251',n:'Digital Design I: 2D',h:2,p:['COAD 1314']}]},

{id:'S2',hrs:16,courses:[
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'IDES E2',n:'Natural & Physical Science Elective I',h:4,p:[],el:1},
{c:'COAD 2333',n:'Environmental Psychology for Design',h:3,p:['COAD 1313']},
{c:'IDES 2312',n:'Interior Design IV — Commercial Studio',h:3,p:['IDES 2311']},
{c:'COAD 2252',n:'Digital Design II: 3D',h:2,p:['COAD 2251']}]},

{id:'J1',hrs:17,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'IDES 3411',n:'Interior Design V — Office Design Studio',h:4,p:['IDES 2312','COAD 2252']},
{c:'COAD 3341',n:'Built World Design History and Theory I',h:3,p:['COAD 2333']},
{c:'IDES 3321',n:'Interior Building System',h:3,p:['IDES 2332']},
{c:'IDES 3331',n:'Interior Lighting',h:3,p:['COAD 1314','IDES 2332','MATH 1312']}]},

{id:'J2',hrs:15,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:['ALIS 1211']},
{c:'IDES 3412',n:'Interior Design VI — Hospitality Studio',h:4,p:['IDES 3411']},
{c:'COAD 3342',n:'Built World Design History and Theory II',h:3,p:['COAD 3341']},
{c:'COAD 3322',n:'Building Codes and Universal Design',h:3,p:['IDES 3321']},
{c:'COAD 3353',n:'Digital Design III: BIM',h:3,p:['COAD 2252']}]},

{id:'SU',hrs:3,courses:[
{c:'IDES 3338',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:14,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:['ALIS 1212']},
{c:'IDES E3',n:'Natural & Physical Science Elective II',h:4,p:[],el:1},
{c:'IDES 4112',n:'Capstone Project Research / Pre-Design',h:1,p:['IDES 3338','IDES 3412']},
{c:'IDES 4337',n:'Sustainable Design',h:3,p:['IDES 3321']},
{c:'IDES 4425',n:'Interior Design VII — Healthcare Studio',h:4,p:['IDES 3412']}]},

{id:'R2',hrs:15,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:['ALIS 2211']},
{c:'IDES E4',n:'Social Science Elective II',h:3,p:[],el:1},
{c:'IDES 4413',n:'Interior Design Capstone Project Studio',h:4,p:['IDES 4112','IDES 4425']},
{c:'IDES 4343',n:'Professional Practices',h:3,p:['IDES 4112']},
{c:'IDES E5',n:'Technical Elective',h:3,p:[],el:1}]}
]},

GDES:{name:'Graphic Design',ar:'التصميم الجرافيكي',total:125,tech:{},sems:[
{id:'F1',hrs:16,courses:[
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'GDES 1311',n:'Drawing',h:3,p:[]},
{c:'GDES 1321',n:'2D Design',h:3,p:[]},
{c:'GDES 1331',n:'Art Appreciation',h:3,p:[]}]},

{id:'F2',hrs:15,courses:[
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:['PHED 1111']},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'GDES 1312',n:'Digital Imaging',h:3,p:['GDES 1311']},
{c:'GDES 1322',n:'3D Design',h:3,p:['GDES 1321']},
{c:'GDES 1332',n:'Art History',h:3,p:['GDES 1331']}]},

{id:'S1',hrs:15,courses:[
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:['UNIV 1211']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'GDES 2311',n:'Typography I',h:3,p:['GDES 1321']},
{c:'GDES 2321',n:'Illustration',h:3,p:['GDES 1322']},
{c:'GDES 2331',n:'History of Visual Communication',h:3,p:['GDES 1332']}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:['MATH 1311']},
{c:'GDES 2312',n:'Arabic Typography',h:3,p:['GDES 2311']},
{c:'GDES 2322',n:'Digital Photography',h:3,p:['GDES 1312']},
{c:'GDES 2332',n:'Design Thinking',h:3,p:['GDES 2331','UNIV 1212']}]},

{id:'J1',hrs:16,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:['ALIS 1211']},
{c:'GDES 3311',n:'Typography II',h:3,p:['GDES 2311']},
{c:'GDES 3321',n:'Brand Identity',h:3,p:['GDES 2311','GDES 2321']},
{c:'GDES 3331',n:'Interaction I',h:3,p:['GDES 2312','GDES 2322','GDES 2332']},
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'GDES E1',n:'Social Science Elective I',h:3,p:[],el:1}]},

{id:'J2',hrs:15,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:['ALIS 1212']},
{c:'GDES 3312',n:'Information Design',h:3,p:['GDES 3311','GDES 3321','GDES 3331']},
{c:'GDES 3322',n:'Motion Design',h:3,p:['GDES 3311','GDES 3321','GDES 3331']},
{c:'GDES 3332',n:'Interaction II',h:3,p:['GDES 3331']},
{c:'GDES E2',n:'Natural & Physical Science Elective I',h:4,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'GDES 3338',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:14,courses:[
{c:'GDES E3',n:'Social Science Elective II',h:3,p:[],el:1},
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:['ALIS 2211']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'GDES 4112',n:'Capstone Project Research',h:1,p:['GDES 3331','GDES 3332']},
{c:'GDES 4321',n:'Advanced Graphic Design',h:3,p:['GDES 3312','GDES 3322','GDES 3332']},
{c:'GDES E4',n:'Technical Elective I',h:3,p:[],el:1}]},

{id:'R2',hrs:14,courses:[
{c:'GDES E5',n:'Natural & Physical Science Elective II',h:4,p:[],el:1},
{c:'GDES 4322',n:'Portfolio Development',h:3,p:['GDES 4321']},
{c:'GDES 4413',n:'Graphic Design Capstone Project',h:4,p:['GDES 4321','GDES 4112']},
{c:'GDES E6',n:'Technical Elective II',h:3,p:[],el:1}]}
]},

ACCT:{name:'Accounting',ar:'المحاسبة',total:128,tech:{},sems:[
{id:'F1',hrs:15,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'ACCT E1',n:'Social Science Elective',h:3,p:[],el:1}]},

{id:'F2',hrs:15,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'MATH 1312',n:'Calculus for Business',h:3,p:['MATH 1311']},
{c:'ACCT E2',n:'Natural Science Elective',h:4,p:[],el:1}]},

{id:'S1',hrs:16,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'ACCT 2311',n:'Fundamentals of Financial Accounting',h:3,p:[]},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'ECON 1311',n:'Introduction to Macroeconomics',h:3,p:[]},
{c:'MISY 2311',n:'Introduction to Management Information Systems',h:3,p:[]},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'ACCT 2321',n:'Managerial Accounting',h:3,p:['ACCT 2311']},
{c:'BUSI 2311',n:'Principles of Management',h:3,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ECON 1312',n:'Introduction to Microeconomics',h:3,p:[]},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]}]},

{id:'J1',hrs:14,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'BUSI 3311',n:'Legal Environment of Business',h:3,p:[]},
{c:'BUSI 3321',n:'Operations Management',h:3,p:['MATH 1313']},
{c:'ACCT 3311',n:'Intermediate Accounting I',h:3,p:['ACCT 2321']},
{c:'FINA 3311',n:'Financial Management Principles',h:3,p:['ACCT 2321']}]},

{id:'J2',hrs:15,courses:[
{c:'BUSI 3312',n:'Organizational Behavior',h:3,p:['BUSI 2311']},
{c:'BUSI 3313',n:'Marketing Principles',h:3,p:[]},
{c:'ACCT 3312',n:'Introduction to Accounting Information Systems',h:3,p:['ACCT 2321']},
{c:'ACCT 3321',n:'Intermediate Accounting II',h:3,p:['ACCT 3311']},
{c:'ACCT E3',n:'Finance or MIS Elective',h:3,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'BUSI 4351',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:18,courses:[
{c:'ACCT 4311',n:'Auditing & Assurance Services',h:3,p:['ACCT 3321']},
{c:'BUSI 4361',n:'Entrepreneurship',h:3,p:['BUSI 3313']},
{c:'ACCT E4',n:'Accounting Elective I',h:3,p:[],el:1},
{c:'ACCT E5',n:'Business Elective I',h:3,p:[],el:1},
{c:'ACCT E6',n:'Business Elective II',h:3,p:[],el:1},
{c:'ACCT E7',n:'Finance or MIS Elective II',h:3,p:[],el:1}]},

{id:'R2',hrs:15,courses:[
{c:'ASSE 4311',n:'Learning Outcome Assessment III — ACCT',h:3,p:['ASSE 3211']},
{c:'ACCT 4321',n:'Accounting Management Planning',h:3,p:['ACCT 3311']},
{c:'BUSI 4362',n:'Strategic Management',h:3,p:[]},
{c:'ACCT E8',n:'Accounting Elective II',h:3,p:[],el:1},
{c:'ACCT E9',n:'Finance or MIS Elective III',h:3,p:[],el:1}]}
]},

BUSI:{name:'Business Administration',ar:'إدارة الأعمال',total:125,tech:{},sems:[
{id:'F1',hrs:15,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'BUSI E1',n:'Social Science Elective',h:3,p:[],el:1}]},

{id:'F2',hrs:15,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'MATH 1312',n:'Calculus for Business',h:3,p:['MATH 1311']},
{c:'BUSI E2',n:'Natural Science Elective',h:4,p:[],el:1}]},

{id:'S1',hrs:16,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'ACCT 2311',n:'Fundamentals of Financial Accounting',h:3,p:[]},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'ECON 1311',n:'Introduction to Macroeconomics',h:3,p:[]},
{c:'MISY 2311',n:'Introduction to Management Information Systems',h:3,p:[]},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'ACCT 2321',n:'Managerial Accounting',h:3,p:['ACCT 2311']},
{c:'BUSI 2311',n:'Principles of Management',h:3,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ECON 1312',n:'Introduction to Microeconomics',h:3,p:[]},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]}]},

{id:'J1',hrs:14,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'BUSI 3311',n:'Legal Environment of Business',h:3,p:[]},
{c:'BUSI 3312',n:'Organizational Behavior',h:3,p:['BUSI 2311']},
{c:'FINA 3311',n:'Financial Management Principles',h:3,p:['ACCT 2321']},
{c:'BUSI E3',n:'Business Elective I',h:3,p:[],el:1}]},

{id:'J2',hrs:15,courses:[
{c:'BUSI 3313',n:'Marketing Principles',h:3,p:[]},
{c:'BUSI 3321',n:'Operations Management',h:3,p:['MATH 1313']},
{c:'BUSI 3323',n:'Introduction to HRM',h:3,p:['BUSI 2311']},
{c:'BUSI 3331',n:'Business Negotiations',h:3,p:[]},
{c:'BUSI E4',n:'Business Elective II',h:3,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'BUSI 4351',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:15,courses:[
{c:'BUSI 4311',n:'E-Commerce',h:3,p:['BUSI 3313','MISY 2311']},
{c:'BUSI 3322',n:'Supply Chain Management',h:3,p:['BUSI 3321']},
{c:'BUSI 4361',n:'Entrepreneurship',h:3,p:['BUSI 3313']},
{c:'BUSI 4321',n:'International Business',h:3,p:['BUSI 2311']},
{c:'BUSI E5',n:'Business Elective III',h:3,p:[],el:1}]},

{id:'R2',hrs:15,courses:[
{c:'ASSE 4311',n:'Learning Outcome Assessment III — BUSI',h:3,p:['ASSE 3211']},
{c:'BUSI 4362',n:'Strategic Management',h:3,p:[]},
{c:'BUSI E6',n:'Accounting Elective',h:3,p:[],el:1},
{c:'BUSI E7',n:'Finance Elective',h:3,p:[],el:1},
{c:'BUSI E8',n:'MIS Elective',h:3,p:[],el:1}]}
]},

FINA:{name:'Finance',ar:'التمويل',total:125,tech:{},sems:[
{id:'F1',hrs:15,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'FINA E1',n:'Social Science Elective',h:3,p:[],el:1}]},

{id:'F2',hrs:15,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'MATH 1312',n:'Calculus for Business',h:3,p:['MATH 1311']},
{c:'FINA E2',n:'Natural Science Elective',h:4,p:[],el:1}]},

{id:'S1',hrs:16,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'ACCT 2311',n:'Fundamentals of Financial Accounting',h:3,p:[]},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'ECON 1311',n:'Introduction to Macroeconomics',h:3,p:[]},
{c:'MISY 2311',n:'Introduction to Management Information Systems',h:3,p:[]},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'ACCT 2321',n:'Managerial Accounting',h:3,p:['ACCT 2311']},
{c:'BUSI 2311',n:'Principles of Management',h:3,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ECON 1312',n:'Introduction to Microeconomics',h:3,p:[]},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]}]},

{id:'J1',hrs:14,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'BUSI 3311',n:'Legal Environment of Business',h:3,p:[]},
{c:'BUSI 3312',n:'Organizational Behavior',h:3,p:['BUSI 2311']},
{c:'FINA 3311',n:'Financial Management Principles',h:3,p:['ACCT 2321']},
{c:'FINA E3',n:'MIS Elective',h:3,p:[],el:1}]},

{id:'J2',hrs:15,courses:[
{c:'FINA 3312',n:'Financial Institutions',h:3,p:['FINA 3311']},
{c:'FINA 3313',n:'Money and Banking',h:3,p:['FINA 3311']},
{c:'BUSI 3313',n:'Marketing Principles',h:3,p:[]},
{c:'BUSI 3321',n:'Operations Management',h:3,p:['MATH 1313']},
{c:'ACCT 3311',n:'Intermediate Accounting I',h:3,p:['ACCT 2321']}]},

{id:'SU',hrs:3,courses:[
{c:'BUSI 4351',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:15,courses:[
{c:'FINA 3314',n:'Financial Statement Analysis',h:3,p:['ACCT 2321']},
{c:'FINA 4313',n:'Investments',h:3,p:['MATH 1313','FINA 3311']},
{c:'FINA 4314',n:'International Finance',h:3,p:['FINA 3311']},
{c:'BUSI 4361',n:'Entrepreneurship',h:3,p:['BUSI 3313']},
{c:'FINA E4',n:'Business Elective',h:3,p:[],el:1}]},

{id:'R2',hrs:15,courses:[
{c:'ASSE 4311',n:'Learning Outcome Assessment III — FINA',h:3,p:['ASSE 3211']},
{c:'FINA 4315',n:'Security Analysis & Portfolio Management',h:3,p:['FINA 4313']},
{c:'BUSI 4362',n:'Strategic Management',h:3,p:[]},
{c:'FINA E5',n:'Finance Elective',h:3,p:[],el:1},
{c:'FINA E6',n:'Accounting or Finance Elective',h:3,p:[],el:1}]}
]},

MISY:{name:'Management Information Systems',ar:'نظم المعلومات الإدارية',total:125,tech:{},sems:[
{id:'F1',hrs:15,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'MISY E1',n:'Social Science Elective',h:3,p:[],el:1}]},

{id:'F2',hrs:15,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'MATH 1312',n:'Calculus for Business',h:3,p:['MATH 1311']},
{c:'MISY E2',n:'Natural Science Elective',h:4,p:[],el:1}]},

{id:'S1',hrs:16,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'ACCT 2311',n:'Fundamentals of Financial Accounting',h:3,p:[]},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'ECON 1311',n:'Introduction to Macroeconomics',h:3,p:[]},
{c:'MISY 2311',n:'Introduction to Management Information Systems',h:3,p:[]},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'BUSI 2311',n:'Principles of Management',h:3,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'MISY 2312',n:'Introduction to Programming for MIS',h:3,p:['MISY 2311']},
{c:'ECON 1312',n:'Introduction to Microeconomics',h:3,p:[]},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]}]},

{id:'J1',hrs:14,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'MISY 2313',n:'Intermediate Programming for MIS',h:3,p:['MISY 2312']},
{c:'MISY 3312',n:'Introduction to Telecommunications',h:3,p:['MISY 2311']},
{c:'BUSI 3311',n:'Legal Environment of Business',h:3,p:[]},
{c:'BUSI 3312',n:'Organizational Behavior',h:3,p:['BUSI 2311']}]},

{id:'J2',hrs:15,courses:[
{c:'BUSI 3313',n:'Marketing Principles',h:3,p:[]},
{c:'BUSI 3321',n:'Operations Management',h:3,p:['MATH 1313']},
{c:'MISY 3311',n:'Database Management',h:3,p:['MISY 2311']},
{c:'MISY 3322',n:'Systems Analysis and Design',h:3,p:['MISY 2313']},
{c:'ACCT 2321',n:'Managerial Accounting',h:3,p:['ACCT 2311']}]},

{id:'SU',hrs:3,courses:[
{c:'BUSI 4351',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:15,courses:[
{c:'MISY 4331',n:'Building Electronic Commerce',h:3,p:['MISY 2313','MISY 3311']},
{c:'MISY 4333',n:'Introduction to Information Assurance',h:3,p:['MISY 3312']},
{c:'MISY 4341',n:'Object Oriented Analysis & Design',h:3,p:['MISY 3311','MISY 3322']},
{c:'MISY E3',n:'MIS Elective',h:3,p:[],el:1},
{c:'MISY E4',n:'Business Elective I',h:3,p:[],el:1}]},

{id:'R2',hrs:15,courses:[
{c:'ASSE 4311',n:'Learning Outcome Assessment III — MISY',h:3,p:['ASSE 3211']},
{c:'FINA 3311',n:'Financial Management Principles',h:3,p:['ACCT 2321']},
{c:'BUSI 4361',n:'Entrepreneurship',h:3,p:['BUSI 3313']},
{c:'BUSI 4362',n:'Strategic Management',h:3,p:[]},
{c:'MISY E5',n:'Business Elective II',h:3,p:[],el:1}]}
]},

HRMT:{name:'Human Resource Management',ar:'إدارة الموارد البشرية',total:128,tech:{},sems:[
{id:'F1',hrs:15,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'HRMT E1',n:'Social Science Elective',h:3,p:[],el:1}]},

{id:'F2',hrs:15,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'MATH 1312',n:'Calculus for Business',h:3,p:['MATH 1311']},
{c:'HRMT E2',n:'Natural Science Elective',h:4,p:[],el:1}]},

{id:'S1',hrs:16,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'ACCT 2311',n:'Fundamentals of Financial Accounting',h:3,p:[]},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'ECON 1311',n:'Introduction to Macroeconomics',h:3,p:[]},
{c:'MISY 2311',n:'Introduction to Management Information Systems',h:3,p:[]},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'ACCT 2321',n:'Managerial Accounting',h:3,p:['ACCT 2311']},
{c:'BUSI 2311',n:'Principles of Management',h:3,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ECON 1312',n:'Introduction to Microeconomics',h:3,p:[]},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]}]},

{id:'J1',hrs:17,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'HRMT 3321',n:'Human Resource Management',h:3,p:['BUSI 2311']},
{c:'FINA 3311',n:'Financial Management Principles',h:3,p:['ACCT 2321']},
{c:'BUSI 3311',n:'Legal Environment of Business',h:3,p:[]},
{c:'BUSI 3312',n:'Organizational Behavior',h:3,p:['BUSI 2311']},
{c:'BUSI 3313',n:'Marketing Principles',h:3,p:[]}]},

{id:'J2',hrs:15,courses:[
{c:'BUSI 3321',n:'Operations Management',h:3,p:['MATH 1313']},
{c:'HRMT 3331',n:'Staffing',h:3,p:['HRMT 3321']},
{c:'HRMT 3332',n:'Training and Development',h:3,p:['HRMT 3321']},
{c:'HRMT 3335',n:'Strategic Human Resource Planning',h:3,p:['HRMT 3321']},
{c:'HRMT E3',n:'Business or HRMT Elective',h:3,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'BUSI 4351',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:15,courses:[
{c:'HRMT 4333',n:'Compensation and Benefits',h:3,p:['HRMT 3321']},
{c:'HRMT 4334',n:'Employee Relations',h:3,p:['HRMT 3321','BUSI 3311']},
{c:'HRMT 4336',n:'Performance Management',h:3,p:['HRMT 3321']},
{c:'HRMT 4337',n:'Research Methods in HRM',h:3,p:['HRMT 3321']},
{c:'HRMT E4',n:'HRM Elective I',h:3,p:[],el:1}]},

{id:'R2',hrs:15,courses:[
{c:'ASSE 4311',n:'Learning Outcome Assessment III — HRMT',h:3,p:['ASSE 3211']},
{c:'BUSI 4361',n:'Entrepreneurship',h:3,p:['BUSI 3313']},
{c:'BUSI 4362',n:'Strategic Management',h:3,p:[]},
{c:'HRMT E5',n:'HRM Elective II',h:3,p:[],el:1},
{c:'HRMT E6',n:'HRM Elective III',h:3,p:[],el:1}]}
]},

MKDM:{name:'Marketing & Digital Media',ar:'التسويق والإعلام الرقمي',total:128,tech:{},sems:[
{id:'F1',hrs:15,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'MATH 1311',n:'Finite Math for Business',h:3,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:[]},
{c:'MKDM E1',n:'Social Science Elective',h:3,p:[],el:1}]},

{id:'F2',hrs:15,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:[]},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'MATH 1312',n:'Calculus for Business',h:3,p:['MATH 1311']},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:[]},
{c:'MKDM E2',n:'Natural Science Elective',h:4,p:[],el:1}]},

{id:'S1',hrs:16,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:[]},
{c:'ACCT 2311',n:'Fundamentals of Financial Accounting',h:3,p:[]},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']},
{c:'ECON 1311',n:'Introduction to Macroeconomics',h:3,p:[]},
{c:'MISY 2311',n:'Introduction to Management Information Systems',h:3,p:[]},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:[]}]},

{id:'S2',hrs:17,courses:[
{c:'ACCT 2321',n:'Managerial Accounting',h:3,p:['ACCT 2311']},
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:[]},
{c:'BUSI 2311',n:'Principles of Management',h:3,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'ECON 1312',n:'Introduction to Microeconomics',h:3,p:[]},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]}]},

{id:'J1',hrs:17,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'BUSI 3311',n:'Legal Environment of Business',h:3,p:[]},
{c:'BUSI 3312',n:'Organizational Behavior',h:3,p:['BUSI 2311']},
{c:'BUSI 3313',n:'Marketing Principles',h:3,p:[]},
{c:'BUSI 3321',n:'Operations Management',h:3,p:['MATH 1312','MATH 1313']},
{c:'FINA 3311',n:'Financial Management Principles',h:3,p:['ACCT 2321','ECON 1311','ECON 1312']}]},

{id:'J2',hrs:15,courses:[
{c:'MKDM 3324',n:'Consumer Behavior',h:3,p:['BUSI 3313']},
{c:'MKDM 3334',n:'Digital and Social Media',h:3,p:['BUSI 3313']},
{c:'MKDM 3344',n:'Brand Management',h:3,p:['BUSI 3313']},
{c:'MKDM 3354',n:'Market Research',h:3,p:['MATH 1313','BUSI 3313']},
{c:'MKDM E3',n:'Business Elective I',h:3,p:[],el:1}]},

{id:'SU',hrs:3,courses:[
{c:'BUSI 4351',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:15,courses:[
{c:'BUSI 4361',n:'Entrepreneurship',h:3,p:['ACCT 2321','BUSI 3312','BUSI 3313']},
{c:'MKDM 3364',n:'Public Relations',h:3,p:['BUSI 3313']},
{c:'MKDM 4314',n:'Advertising Management',h:3,p:['BUSI 3313']},
{c:'MKDM 4335',n:'Media Strategy & Metrics',h:3,p:['MKDM 3334','MKDM 3354']},
{c:'MKDM E4',n:'Business Elective II',h:3,p:[],el:1}]},

{id:'R2',hrs:15,courses:[
{c:'ASSE 4311',n:'Learning Outcome Assessment III — MKTG',h:3,p:['ASSE 3211']},
{c:'BUSI 4362',n:'Strategic Management',h:3,p:[]},
{c:'MKDM 4342',n:'Advertising Design',h:3,p:['MKDM 3334','MKDM 4314']},
{c:'MKDM 4390',n:'The IMC Campaign',h:3,p:['MKDM 4335']},
{c:'MKDM E5',n:'Business Elective III',h:3,p:[],el:1}]}
]},

LAWB:{name:'Law',ar:'القانون',total:138,tech:{},sems:[
{id:'F1',hrs:16,courses:[
{c:'ALIS 1211',n:'Introduction to Islamic Culture',h:2,p:[]},
{c:'COMM 1311',n:'Written Communication',h:3,p:[]},
{c:'ITLB 2211',n:'Intro to Computer Concepts and Applications',h:2,p:[]},
{c:'UNIV 1211',n:'Prof. Development and Competencies',h:2,p:[]},
{c:'LAWB 1321',n:'Intro to Law (Arabic)',h:3,p:[]},
{c:'LAWB E1',n:'Social Science Elective',h:3,p:[],el:1},
{c:'PHED 1111',n:'Active Living Lifestyle',h:1,p:[]}]},

{id:'F2',hrs:17,courses:[
{c:'ALIS 1212',n:'The Social System in Islam',h:2,p:['ALIS 1211']},
{c:'COMM 1312',n:'Writing and Research',h:3,p:['COMM 1311']},
{c:'UNIV 1212',n:'Critical Thinking and Problem Solving',h:2,p:['UNIV 1211']},
{c:'MATH 1313',n:'Statistical Methods',h:3,p:[]},
{c:'LAWB 1311',n:'Usul Al-Fiqh',h:3,p:[]},
{c:'LAWB 1322',n:'Sources of Obligation',h:3,p:['LAWB 1321']},
{c:'PHED 1112',n:'Healthy Behaviors and Management',h:1,p:['PHED 1111']}]},

{id:'S1',hrs:16,courses:[
{c:'ALIS 2211',n:'Linguistic Communication Skills',h:2,p:['ALIS 1212']},
{c:'UNIV 1213',n:'Leadership and Teamwork',h:2,p:['UNIV 1212']},
{c:'LAWB 2323',n:'Provisions of Obligation',h:3,p:['LAWB 1322']},
{c:'LAWC 2311',n:'Global Legal Systems',h:3,p:['LAWB 1321']},
{c:'LAWB 2361',n:'Legal Writing and Research',h:3,p:['LAWB 1321']},
{c:'COMM 2311',n:'Oral Communication',h:3,p:['COMM 1312']}]},

{id:'S2',hrs:17,courses:[
{c:'ALIS 2212',n:'The Biography of Prophet Mohammad',h:2,p:['ALIS 2211']},
{c:'ASSE 2111',n:'Learning Outcome Assessment I',h:1,p:[]},
{c:'COMM 2312',n:'Technical and Professional Communications',h:3,p:['COMM 2311']},
{c:'LAWB 2331',n:'Constitutional Law',h:3,p:['LAWB 1321']},
{c:'LAWB 2351',n:'Commercial Law',h:3,p:['LAWB 1321']},
{c:'LAWB 2341',n:'General Criminal Law',h:3,p:['LAWB 1321']},
{c:'LAWB 2224',n:'Civil Contracts',h:2,p:['LAWB 2323']}]},

{id:'J1',hrs:17,courses:[
{c:'LAWB 3325',n:'Labor Law and Social Security',h:3,p:['LAWB 2224']},
{c:'LAWB 3352',n:'Company Law and Bankruptcy',h:3,p:['LAWB 2351']},
{c:'LAWB 3342',n:'Private Criminal Law',h:3,p:['LAWB 2341']},
{c:'LAWB 3212',n:'Family Law',h:2,p:['LAWB 1311']},
{c:'INTL 3321',n:'Public International Law',h:3,p:['LAWC 2311']},
{c:'LAWB 3326',n:'Property & Real Securities',h:3,p:['LAWB 2224']}]},

{id:'J2',hrs:17,courses:[
{c:'ASSE 3211',n:'Learning Outcome Assessment II',h:2,p:['ASSE 2111']},
{c:'INTL 3322',n:'International Economic Law',h:3,p:['INTL 3321']},
{c:'LAWB 3362',n:'Civil Procedure Law',h:3,p:['LAWB 2224']},
{c:'LAWB 3332',n:'Administrative Law',h:3,p:['LAWB 2331']},
{c:'LAWB 3363',n:'Criminal Procedure Law',h:3,p:['LAWB 3342']},
{c:'LAWB 3315',n:'Law of Zakat and Taxation',h:3,p:['LAWB 1311']}]},

{id:'SU',hrs:3,courses:[
{c:'LAWB 4365',n:'Internship',h:3,p:[]}]},

{id:'R1',hrs:17,courses:[
{c:'LAWB 4362',n:'Civil Enforcement Law',h:3,p:['LAWB 3362']},
{c:'LAWB 4316',n:'Wills and Inheritance',h:3,p:['LAWB 3212']},
{c:'LAWB 4353',n:'Commercial Papers and Banking',h:3,p:['LAWB 3352']},
{c:'LAWB 4333',n:'Administrative Judiciary',h:3,p:['LAWB 3332']},
{c:'LAWC 4211',n:'Legal Ethics',h:2,p:[]},
{c:'LAWB 4364',n:'Internal Legal Practice',h:3,p:['LAWB 3362','LAWB 3363']}]},

{id:'R2',hrs:18,courses:[
{c:'ASSE 4311',n:'Learning Assessment III (Capstone)',h:3,p:['ASSE 3211','LAWB 2361']},
{c:'INTL 4341',n:'Alternative Dispute Resolution',h:3,p:[]},
{c:'INTL 4351',n:'Intellectual Property Law',h:3,p:[]},
{c:'LAWB 4371',n:'Private International Law',h:3,p:['LAWB 3362']},
{c:'LAWB E2',n:'Law Elective (English) I',h:2,p:[],el:1},
{c:'LAWB E3',n:'Law Elective (English) II',h:2,p:[],el:1},
{c:'LAWB E4',n:'Law Elective (Arabic)',h:2,p:[],el:1}]}
]}

};

/* ═══ نسخة الخطة: تخصص → مفتاح خطته القديمة ═══
   PLAN_VER (اختيار الطالب) يبقى في الصفحة — هذا بيانات، وذاك حالة. */
const PLAN_ALT={MEEN:'MEEN_OLD'};              /* تخصص → مفتاح خطته القديمة */

/* ═══════════ تواريخ التسجيل حسب المستوى ═══════════
   من تقويم التسجيل المعتمد للترم الأول ٢٠٢٦–٢٠٢٧.
   يختفي الكرت كامل بعد نهاية فترة الحذف. */
const REG_CAL={
  /* جدول المستويات ينتهي بانتهاء آخر يوم فيه (فريشمان 27 أغسطس).
     بعدها التسجيل مفتوح للجميع، فالجدول يصير معلومة ميتة تشغل
     أهم مساحة في الصفحة. أما بقية المواعيد فتبقى في «مواعيد تهمك». */
  hideAfter:'2026-08-27',
  termAr:'الترم الأول ٢٠٢٦–٢٠٢٧', termEn:'Fall 2026–2027',
  rows:[
    {k:'eve', d:'2026-08-23', ar:'مسائي · دراسات عليا · تحضيري',
     en:'Evening · Graduate · Prep', hAr:'كل المستويات', hEn:'All levels'},
    {k:'sr',  d:'2026-08-24', min:90, ar:'سينيور', en:'Senior',
     hAr:'٩٠ ساعة فأكثر', hEn:'90 credits and above'},
    {k:'jr',  d:'2026-08-25', min:60, ar:'جونيور', en:'Junior',
     hAr:'٦٠ – ٨٩ ساعة', hEn:'60 – 89 credits'},
    {k:'so',  d:'2026-08-26', min:30, ar:'سوفومور', en:'Sophomore',
     hAr:'٣٠ – ٥٩ ساعة', hEn:'30 – 59 credits'},
    {k:'fr',  d:'2026-08-27', min:0,  ar:'فريشمان', en:'Freshman',
     hAr:'٠ – ٢٩ ساعة', hEn:'0 – 29 credits'}
  ],
  addDrop:{s:'2026-08-28',e:'2026-09-03'},
  drop:{s:'2026-09-06',e:'2026-09-10'}
};

/* ================= GUIDE ================= */
const GUIDE={
ar:{title:'كيف تستخدم جدولك',lead:'مقسّم على أقسام — افتح اللي يهمك',
newLbl:'جديد',
sections:[
{ic:'🚀',name:'ابدأ من هنا',open:1,items:[
 {t:'اختر تخصصك',d:'من <b>⚙️ الإعدادات</b> اختر تخصصك — <b>٢٠ تخصص</b>، كل كليات الجامعة. الخطة والساعات والمتطلبات تتغيّر معك تلقائياً.'},
 {t:'علّم اللي خلصته',d:'في <b>📋 خطتي</b> اضغط المربّع جنب كل مادة درستها. المواد اللي متطلبها ناقص تظهر <b>مقفلة</b>، وتنفتح أول ما تعلّم متطلبها.'},
 {t:'ابحث وابنِ جدولك',d:'في <b>🔍 البحث</b> اختر الترم واضغط ابحث. الفلتر يقبل <b>كود المادة</b> أو <b>CRN</b> أو <b>اسم المادة</b> أو <b>اسم الدكتور</b>. اضغط <b>➕</b> على أي شعبة تضيفها.'}]},

{ic:'☀️',name:'يومك',isNew:1,items:[
 {t:'وين أنت من يومك',isNew:1,d:'تبويب <b>اليوم</b> يرتّب محاضراتك بالترتيب: الجارية تتلوّن أخضر ومعها شريط يمشي، و<b>خط «الآن»</b> يتحرك بينها مع الساعة، واللي خلص يبهت لحاله.'},
 {t:'فراغاتك مكتوبة',isNew:1,d:'بين كل محاضرتين يطلع سطر مثل «فراغ ١ ساعة و١٠ د» — تعرف متى تذاكر ومتى ترجع البيت بدون ما تحسب.'},
 {t:'اضغط المادة يفتح ملفها',d:'أي محاضرة تضغطها ينفتح لوح فيه وقتها وقاعتها ودكتورها، وتحته كل شي يخص المادة.'},
 {t:'الغياب',isNew:1,d:'سجّل غيابك بتاريخه، ويحسب لك النسبة تلقائياً — الحد <b>١٥٪</b> من محاضرات الترم. العدّاد يقول لك <b>٢ من ٤</b> قبل ما توصل الحرمان.<br><b>ملاحظة:</b> الحساب إرشادي، والمرجع الرسمي سجل الجامعة.'},
 {t:'مواعيد المادة',isNew:1,d:'كويز · واجب · مشروع · ميدتيرم · نهائي. تكتبه مرة ويطلع في يومه ويذكّرك قبله. وتقدر تعدّله أو تأجّله.'},
 {t:'صور وملفات المادة',isNew:1,d:'صوّر السبورة أو ارفع الملخص — ينحفظ على المادة نفسها وتلقاه وقت المذاكرة، بدل ما يضيع بين ألف صورة في ألبومك. الصور تُضغط تلقائياً، والحد ١٠ ميغا للملف.'},
 {t:'شارك مع شعبتك',isNew:1,d:'أي موعد أو ملف تقدر تشاركه بضغطة <b>📢</b> فيوصل لزملائك في <b>نفس الشعبة</b> وبدون اسمك.<br>🔒 وكل شي ترفعه <b>خاص فيك</b> ما لم تختر تشاركه.'},
 {t:'أسبوعك كامل',isNew:1,d:'بدّل لـ<b>الأسبوع</b> تشوف الخمسة أيام: عدد محاضرات كل يوم ووقت أول وآخر وحدة، ومواعيدك في يومها، وتواريخ الحذف والانسحاب. وتقدر تتنقل بين أسابيع الترم.'}]},

{ic:'📅',name:'جدولك',items:[
 {t:'ثلاثة جداول تجرّب فيها',d:'<b>جدول ١ · ٢ · ٣</b> — جرّب توزيعات مختلفة قبل ما تقرر، وبدّل بينها بضغطة.'},
 {t:'التعارض ينبّهك',d:'لو أضفت شعبة تتعارض مع مادة عندك، الموقع يقول لك قبل ما تسجّل — لا بعدها.'},
 {t:'الشبكة واضغط أي مادة',isNew:1,d:'حوّل لـ<b>شبكة</b> تشوف أسبوعك كجدول، بثلاثة أحجام. والاسم مقطوع؟ اضغط المادة تطلع لك بطاقة فيها الاسم والقاعة والدكتور كاملة، وتختفي بأي لمسة.'},
 {t:'اطبع جدولك',d:'<b>🖨️ اطبع</b> يطلع ورقة واحدة منظّمة — شبكة أسبوعية ملوّنة تبيّن فراغاتك، ومعها اختباراتك النهائية.'},
 {t:'اختباراتك النهائية',d:'اضغط <b>اعرض</b> تحت «اختباراتك النهائية» — موعد وقاعة كل اختبار، وتنبيه لو صار اختبارين بنفس الوقت.'},
 {t:'مواعيد تهمك',d:'أقرب المواعيد بعدّاد أيام: التسجيل، بداية الدراسة، <b>آخر يوم انسحاب</b>، والاختبارات. القريبة تتلوّن تنبيهاً.'}]},

{ic:'📋',name:'خطتك ومعدلك',items:[
 {t:'مقترح الترم الجاي',d:'فوق الخطة يطلع لك مقترح جاهز بناءً على اللي خلصته.'},
 {t:'«لا تؤجلها»',d:'المواد المعلّمة كذا تفتح لك مواد بعدها — تأجيلها يأخّر تخرّجك.'},
 {t:'احسب معدلك',d:'حط درجة أي مادة خلصتها والمعدل يتحدّث فوراً بنظام الجامعة (‎A+‎ = 4.00). وتقدر تسأل: كم لازم أجيب هذا الترم عشان أوصل معدل معيّن.'},
 {t:'اضغط مادة تشوف شعبها',d:'من الخطة أو المقترح — اضغط أي مادة ينقلك للبحث ويوريك شعبها وأوقاتها ودكاترتها في <b>ترم التسجيل القادم</b>.'}]},

{ic:'🔔',name:'تنبيهاتك',items:[
 {t:'راقب المواد المسكّرة',d:'أي مادة <code>CLOSE</code> جنبها <b>🔕</b> — اضغطه يصير <b>🔔</b>. السيرفر يفحص كل ٥ دقائق <b>حتى والموقع مسكّر</b>، فما تحتاج تفتح الصفحة.'},
 {t:'اربط تيليغرام',d:'من <b>⚙️ الإعدادات</b> اضغط «ربط» → يفتح البوت → Start. أول ما تنفتح مادتك يوصلك إشعار فيه الـCRN والوقت والقاعة.'},
 {t:'لو تغيّر جدولك',isNew:1,d:'غيّرت الجامعة دكتور أو قاعة أو وقت مادة عندك؟ يوصلك إشعار، ويظهر تنبيه على المادة في جدولك يبيّن لك <b>وش كان ووش صار</b>.'},
 {t:'تحكّم بالتنبيهات',isNew:1,d:'من <b>⚙️ الإعدادات</b> اختر أي إشعار تبيه وأيهم لا — كل نوع بمفتاح مستقل.'}]},

{ic:'👨‍🏫',name:'الدكاترة ورأيك',items:[
 {t:'قيّم دكاترتك',d:'في <b>👨‍🏫 دكاترة</b> شوف تقييمات الطلاب قبل ما تسجّل، وقيّم أنت <b>بشكل مجهول</b> — ما أحد يشوف اسمك. وفي صفحة كل دكتور زر «شوف مواده هذا الترم».'},
 {t:'حفظ سحابي',d:'خطتك وجدولك ومعدلك محفوظة في حسابك — افتح من أي جهاز وتلقى كل شي زي ما تركته.'},
 {t:'قول لنا رأيك',d:'في <b>⚙️ الإعدادات</b> خانة «رأيك يهمنا» — اكتب أي اقتراح أو مشكلة. توصلنا فوراً، وإذا حطيت وسيلة تواصل نرد عليك.'}]}],
tip:'<b>🎁 كل الميزات مفتوحة مجاناً</b> — جدولك في فترة تجريبية، سجّل دخول واستمتع بكل شي بدون أي رسوم.'},

en:{title:'How to use Jadwalik',lead:'Split into sections — open what matters to you',
newLbl:'New',
sections:[
{ic:'🚀',name:'Start here',open:1,items:[
 {t:'Pick your major',d:'In <b>⚙️ Settings</b> choose your major — <b>20 programs</b>, every college. Your plan, credits and prerequisites switch automatically.'},
 {t:'Mark what you finished',d:'In <b>📋 My Plan</b> tick the box next to each course you passed. Courses missing a prerequisite show as <b>locked</b> and open the moment you tick it.'},
 {t:'Search and build',d:'In <b>🔍 Search</b> pick the term and hit search. The filter accepts a <b>course code</b>, <b>CRN</b>, <b>course title</b> or <b>instructor name</b>. Tap <b>➕</b> on any section to add it.'}]},

{ic:'☀️',name:'Your day',isNew:1,items:[
 {t:'Where you are in your day',isNew:1,d:'The <b>Today</b> tab lays out your lectures in order: the running one turns green with a bar that moves, a <b>“now” line</b> travels between them with the clock, and finished ones fade on their own.'},
 {t:'Your gaps, spelled out',isNew:1,d:'Between lectures you get a line like “1h 10m break” — so you know when to study and when to head home, without doing the maths.'},
 {t:'Tap a course for its file',d:'Tap any lecture and a sheet opens with its time, room and instructor, and everything about that course underneath.'},
 {t:'Absences',isNew:1,d:'Log an absence with its date and the rate is calculated for you — the limit is <b>15%</b> of the term\'s lectures. The counter tells you <b>2 of 4</b> before you hit exclusion.<br><b>Note:</b> this is indicative; the official record is the university\'s.'},
 {t:'Course deadlines',isNew:1,d:'Quiz · homework · project · midterm · final. Enter it once and it appears on its day and reminds you beforehand. You can edit it or snooze it.'},
 {t:'Photos and files',isNew:1,d:'Snap the board or upload the summary — it is saved on the course itself and waiting when you revise, instead of getting lost among a thousand photos. Images are compressed automatically; the limit is 10 MB per file.'},
 {t:'Share with your section',isNew:1,d:'Any deadline or file can be shared with one <b>📢</b> tap — it reaches classmates in <b>your own section</b>, without your name.<br>🔒 Everything you upload is <b>private to you</b> unless you choose to share it.'},
 {t:'Your whole week',isNew:1,d:'Switch to <b>Week</b> for all five days: how many lectures each day and its first and last time, your deadlines on their day, and add/drop and withdrawal dates. You can move between the term\'s weeks.'}]},

{ic:'📅',name:'Your schedule',items:[
 {t:'Three schedules to try',d:'<b>Schedule 1 · 2 · 3</b> — try different arrangements before you commit, and switch with one tap.'},
 {t:'Clashes warn you',d:'If a section you add clashes with a course you already have, you are told before you register — not after.'},
 {t:'Grid view, and tap any course',isNew:1,d:'Switch to <b>Grid</b> to see your week as a timetable, in three sizes. Name cut off? Tap the course and a card shows the full name, room and instructor — it disappears at any touch.'},
 {t:'Print your schedule',d:'<b>🖨️ Print</b> gives you one clean page — a colour-coded weekly grid showing your gaps, with your final exams underneath.'},
 {t:'Your final exams',d:'Tap <b>Show</b> under “Your final exams” — the date and room for every exam, and a warning if two collide.'},
 {t:'Dates that matter',d:'Upcoming dates with a countdown: registration, first day of class, <b>the withdrawal deadline</b>, and finals. Near dates turn amber.'}]},

{ic:'📋',name:'Your plan and GPA',items:[
 {t:'Next term suggestion',d:'A ready plan appears above your degree plan, based on what you have finished.'},
 {t:'“Do not delay”',d:'Courses marked this way unlock later ones — delaying them delays your graduation.'},
 {t:'Calculate your GPA',d:'Enter a grade for any finished course and your GPA updates instantly on the PMU scale (A+ = 4.00). You can also ask what you need this term to reach a target.'},
 {t:'Tap a course for its sections',d:'From the plan or the suggestion — tap any course and it jumps to Search showing its sections, times and instructors for the <b>upcoming registration term</b>.'}]},

{ic:'🔔',name:'Your alerts',items:[
 {t:'Monitor closed sections',d:'Any <code>CLOSE</code> course has a <b>🔕</b> — tap it to make it <b>🔔</b>. The server checks every 5 minutes <b>even with the site closed</b>, so you never keep the page open.'},
 {t:'Link Telegram',d:'In <b>⚙️ Settings</b> tap “Link” → the bot opens → Start. When your course opens you get an alert with the CRN, time and room.'},
 {t:'If your schedule changes',isNew:1,d:'Did the university change an instructor, room or time on one of your courses? You get an alert, and a notice appears on that course showing <b>what it was and what it became</b>.'},
 {t:'Control your alerts',isNew:1,d:'In <b>⚙️ Settings</b> choose which notifications you want and which you do not — each type has its own switch.'}]},

{ic:'👨‍🏫',name:'Faculty and feedback',items:[
 {t:'Rate your instructors',d:'In <b>👨‍🏫 Faculty</b> read student ratings before you register, and rate <b>anonymously</b> — nobody sees your name. Each instructor page has a “See their courses this term” button.'},
 {t:'Cloud sync',d:'Your plan, schedule and GPA live in your account — open from any device and find everything as you left it.'},
 {t:'Tell us what you think',d:'In <b>⚙️ Settings</b> the “Your feedback matters” box takes any idea or problem. It reaches us instantly, and if you leave contact details we reply.'}]}],
tip:'<b>🎁 Everything is free right now</b> — Jadwalik is in open beta. Sign in and enjoy every feature at no cost.'}
};


/* ═══════════ منطق الخطة — دوال صافية ═══════════
   منقولة حرفياً من pmu-schedule.html. الصفحة والمساعد يحسبان بنفسها،
   فما يختلف جوابان على نفس السؤال.

   **صافية بالمعنى الصارم:** ولا DOM، ولا localStorage، ولا متغيّر
   عام من الصفحة، ولا ترجمة. كل مدخل يجي صريحاً في `ctx`. الصفحة
   تبني ctx من حالتها وتمرّره.

   ctx = { major, planVer, prep, completed, grades }
     major     كود التخصص            'COSC'
     planVer   نسخة الخطة            'new' | 'old'
     prep      الطالب في التحضيري؟   true | false
     completed أكواد المواد المنجزة  ['MATH 1422', …]
     grades    التقدير لكل كود       { 'MATH 1422': 'A' }

   ما يعرض نصاً للطالب يبقى في الصفحة: prepLevelLock ترجع **معرّف**
   الترم لا اسمه المترجم، والصفحة تترجمه. */

/* ═══ التحضيري ═══
   الأكواد من الخطط الرسمية الموقّعة ومن صفحة البرنامج في موقع الجامعة.
   مواده بلا ساعات معتمدة ولا تدخل المعدل، والاجتياز فيه من C فأعلى. */

/* مادة رياضيات التحضيري حسب التخصص */
const PREP_MATH={
  MEEN:'PRPM 0022',EEEN:'PRPM 0022',CVEN:'PRPM 0022',CHEN:'PRPM 0022',
  COEN:'PRPM 0022',COSC:'PRPM 0022',SOEN:'PRPM 0022',AINT:'PRPM 0022',
  ARCH:'PRPM 0022',
  CSEC:'PRPM 0012',ITAP:'PRPM 0012',IDES:'PRPM 0012',GDES:'PRPM 0012',
  BUSI:'PRPM 0012',ACCT:'PRPM 0012',FINA:'PRPM 0012',MISY:'PRPM 0012',
  HRMT:'PRPM 0012',MKDM:'PRPM 0012',LAWB:'PRPM 0012'
};
const PREP_MATH_NAME={'PRPM 0022':'Pre-Calculus','PRPM 0012':'Intermediate Algebra'};

/* اجتياز المستوى المتقدم = شرط مواد اللغة والمقدمات في السنة الأولى */
const PREP_EXIT='PREE 0061';

/* مواد الخطة اللي تشترط اجتياز التحضيري — تُفحص فقط لو الطالب مفعّل الخانة */
const PREP_GATE_LANG=['COMM 1311','UNIV 1211','ALIS 1211','PHED 1111'];
const PREP_GATE_MATH=['MATH 1422','PHYS 1421','CHEM 1421','GEEN 1211',
                      'MATH 1311','MATH 1313','ACCT 2311'];

/* تقديرات الرسوب — المادة تُعاد وما تفتح اللي بعدها.
   جامعة الأمير محمد بن فهد: الحد الأدنى للنجاح في متطلب سابق هو C. */
const FAIL_GRADES=['D','F','WF'];
/* التحضيري: الاجتياز من C فأعلى — D+ و D رسوب فيه */
const FAIL_GRADES_C=['D+','D','F','WF'];
/* الانسحاب: الطالب ما اجتاز المادة، فهي باقية عليه كمتطلب
   ولا تفتح المواد اللاحقة، ولا تُحسب ضمن ساعاته المكتسبة. */
const WITHDRAW_GRADES=['W','WP'];

const GRADE_POINTS={'A+':4.00,'A':3.75,'B+':3.50,'B':3.00,
'C+':2.50,'C':2.00,'D+':1.50,'D':1.00,'F':0.00,'WF':0.00};
/* تقديرات لا تدخل في حساب المعدل */
const GRADE_SKIP=['I','IP','AU','EX','TR','W','WP','N','P','AW'];

/* التطبيق العملي للسينيور فقط. نشترط الساعات لأن بيانات المتطلبات
   السابقة ناقصة في بعض التخصصات، فبدونها يظهر لطالب جديد ما بدأ. */
const INTERN_MIN_CREDITS=90;

/* ═══ اختيار الخطة ═══ */
function hasAltPlan(code){ return !!(PLAN_ALT[code]&&PLANS[PLAN_ALT[code]]) }
function planKey(code,planVer){
  return (planVer==='old'&&hasAltPlan(code))?PLAN_ALT[code]:code;
}
function planOf(code,planVer){ return PLANS[planKey(code,planVer)]||PLANS[code] }

/* مستويات التحضيري — مادة الرياضيات تتغيّر حسب التخصص */
function prepSems(major){
  const mc=PREP_MATH[major]||'PRPM 0012';
  const mn=PREP_MATH_NAME[mc]||'';
  return [
  {id:'PP1',label:'التحضيري — المستوى التأسيسي',hrs:0,prep:true,courses:[
    {c:'PRPC 0002',n:'Pre-Beginner Communication Skills',h:0,p:[],adm:true,prep:true},
    {c:'PRPW 0002',n:'Pre-Beginner Writing Skills',h:0,p:[],adm:true,prep:true},
    {c:'PRPE 0002',n:'Pre-Beginner Enhanced Learning',h:0,p:[],adm:true,prep:true}]},

  {id:'PP2',label:'التحضيري — المستوى المبتدئ',hrs:0,prep:true,courses:[
    {c:'PRPC 0021',n:'Beginner Communication Skills',h:0,p:[],adm:true,prep:true},
    {c:'PRPW 0021',n:'Beginner Writing Skills',h:0,p:[],adm:true,prep:true},
    {c:'PRPE 0021',n:'Beginner Enhanced Learning',h:0,p:[],adm:true,prep:true}]},

  {id:'PP3',label:'التحضيري — المستوى المتوسط',hrs:0,prep:true,courses:[
    {c:'PRPC 0041',n:'Intermediate Communication Skills',h:0,p:[],adm:true,prep:true},
    {c:'PRPW 0041',n:'Intermediate Writing Skills',h:0,p:[],adm:true,prep:true},
    {c:'PRPI 0041',n:'Intermediate Enhanced Learning',h:0,p:[],adm:true,prep:true},
    {c:'PRPL 0011',n:'Theories & Applications of Learning I',h:0,p:[],prep:true},
    {c:'PRPM 0011',n:'Introductory Algebra',h:0,p:[],prep:true}]},

  {id:'PP4',label:'التحضيري — المستوى المتقدم',hrs:0,prep:true,courses:[
    {c:'PRPC 0061',n:'Advanced Communication Skills',h:0,p:[],adm:true,prep:true},
    {c:'PRPW 0061',n:'Advanced Writing Skills',h:0,p:[],adm:true,prep:true},
    {c:'PRPA 0061',n:'Advanced Enhanced Learning',h:0,p:[],adm:true,prep:true},
    {c:'PRPL 0012',n:'Theories & Applications of Learning II',h:0,p:[],prep:true},
    {c:mc,n:mn+' — مادة تخصصك',h:0,p:[],prep:true},
    {c:PREP_EXIT,n:'Core Entry Exam — اختبار الخروج',h:0,p:[],adm:true,prep:true}]}
  ];
}

/* فصول الخطة كما تبنيها الصفحة: التحضيري أولاً لمن فعّله */
function semesters(major,planVer,prep){
  const p=planOf(major,planVer);
  if(!p)return [];
  return prep?prepSems(major).concat(p.sems):p.sems;
}

/* ═══ السياق ═══
   يُبنى مرة ويُمرَّر. يحسب الفصول والاختياريات مسبقاً فما نكررها. */
function ctxOf(o){
  o=o||{};
  const major=o.major, planVer=o.planVer==='old'?'old':'new';
  const prep=!!o.prep;
  const p=planOf(major,planVer)||{};
  return {
    major, planVer, prep,
    completed: Array.isArray(o.completed)?o.completed:[],
    grades: (o.grades&&typeof o.grades==='object')?o.grades:{},
    /* sems و tech يقبلان تمريراً صريحاً: الصفحة تبنيهما في applyMajor
       وتمرّر ما عندها بالضبط، فما نعيد حسابهما ونخاطر باختلاف. */
    sems: Array.isArray(o.sems)?o.sems:semesters(major,planVer,prep),
    tech: (o.tech&&typeof o.tech==='object')?o.tech:(p.tech||{}),
    total: o.total!==undefined?o.total:p.total,
    /* الترم المعروض في البحث — مرجع الطالب للتخطيط. الصفحة تقرأه من
       قائمة الترم وتمرّره؛ الافتراضي نفس افتراضي activeTermCode. */
    term: o.term || '202710',
    /* الأصل يقرأ PLANS[MAJOR] لا planOf — أي النسخة الجديدة دائماً.
       نطابقه حرفياً: تغييره يغيّر حد الرسوب على خطة قديمة. */
    minPassC: !!(PLANS[major]&&PLANS[major].minPassC),
  };
}

/* ═══ مساعدات الخطة ═══ */
function allPlanCourses(ctx){return ctx.sems.flatMap(s=>s.courses.map(c=>({...c,sem:s.id})))}
function findPlanCourse(ctx,code){return allPlanCourses(ctx).find(c=>c.c===code)}

function failGrades(ctx){ return ctx.minPassC?FAIL_GRADES_C:FAIL_GRADES }
function isFailed(ctx,code){ return failGrades(ctx).includes(ctx.grades[code]) }
function isWithdrawn(ctx,code){ return WITHDRAW_GRADES.includes(ctx.grades[code]) }

/* "خلّصها" للعرض والتقدّم — يشمل حتى اللي رسب فيها بـ D */
function isDone(ctx,code){ return ctx.completed.includes(code) }

/* "نجح فيها" لفتح المواد اللاحقة — يستثني الرسوب والانسحاب */
function isPassed(ctx,code){
  return ctx.completed.includes(code) && !isFailed(ctx,code) && !isWithdrawn(ctx,code);
}

/* الساعات المنجزة من الخطة: تستثني الراسب والمنسحب مثل نظام الجامعة،
   لأنها تُستخدم في شريط التقدّم وفي متطلبات المستوى (مثل: يلزم 60 ساعة) */
function doneCredits(ctx){
  let t=0;
  allPlanCourses(ctx).forEach(c=>{
    if(isDone(ctx,c.c) && !isFailed(ctx,c.c) && !isWithdrawn(ctx,c.c)) t+=c.h;
  });
  return t;
}
function level(cr){return cr>=90?'Senior':cr>=60?'Junior':cr>=30?'Sophomore':'Freshman'}

/* متطلبات التحضيري تُفحص فقط لمن فعّل الخانة —
   الطالب المقبول مباشرة ما مرّ بالتحضيري فما نقفل عليه شي. */
function prepGate(ctx,code){
  if(!ctx.prep)return [];
  if(PREP_GATE_LANG.includes(code))return [PREP_EXIT];
  if(PREP_GATE_MATH.includes(code))return [PREP_MATH[ctx.major]||'PRPM 0012'];
  return [];
}

/* التحضيري متسلسل: ما يفتح لك مستوى إلا بعد ما تخلّص اللي قبله.
   ترجع **معرّف** الترم واسمه الخام — الترجمة على الصفحة لا هنا. */
function prepLevelLock(ctx,code){
  if(!ctx.prep)return null;
  const i=ctx.sems.findIndex(sem=>sem.prep&&sem.courses.some(c=>c.c===code));
  if(i<=0)return null;
  for(let k=0;k<i;k++){
    const sem=ctx.sems[k];
    if(!sem.prep)continue;
    if(!sem.courses.every(c=>isPassed(ctx,c.c)))
      return {id:sem.id,label:sem.label};
  }
  return null;
}

/* فحص المتطلبات السابقة.
   `missing` أكواد مواد فقط. قفل مستوى التحضيري يرجع في `lock` منفصلاً
   لأنه نص يُعرض للطالب — الصفحة تترجمه وتضيفه لآخر القائمة. */
function prereqCheck(ctx,code){
  const pc=findPlanCourse(ctx,code);
  let reqs=null;
  if(pc) reqs={p:pc.p||[],min:pc.min||0};
  else if(ctx.tech[code]) reqs={p:ctx.tech[code],min:0};
  if(!reqs) return {known:false,ok:true,missing:[],lock:null};
  const missing=reqs.p.concat(prepGate(ctx,code)).filter(r=>!isPassed(ctx,r));
  const lock=prepLevelLock(ctx,code);
  const cr=doneCredits(ctx);
  const needCr=reqs.min&&cr<reqs.min?reqs.min:0;
  return {known:true,ok:missing.length===0&&!lock&&!needCr,
          missing,lock,needCr,haveCr:cr};
}

/* عدد ساعات أي مادة: من الخطة، وإلا من الرقم الثاني في كود المادة (نظام PMU) */
function creditsOf(ctx,code){
  const pc=findPlanCourse(ctx,code);
  if(pc)return pc.h;
  const m=(code||'').match(/(\d{4})/);
  if(m){const d=parseInt(m[1][1]);if(d>=1&&d<=6)return d}
  return 3;
}

/* كم مادة تنفتح لو خلصت هذي المادة */
function unlocksCount(ctx,code){
  /* المادة المكتملة ما تنعد — لو خلصتها فالمتطلب ما عاد يفتح شي */
  return allPlanCourses(ctx).filter(c=>!isDone(ctx,c.c)&&(c.p||[]).includes(code)).length;
}

/* أي المواد تنفتح فعلاً — للمساعد، يشرح لا يعدّ فقط */
function unlockedBy(ctx,code){
  return allPlanCourses(ctx).filter(c=>!isDone(ctx,c.c)&&(c.p||[]).includes(code));
}

/* التطبيق العملي (Internship / Co-op) ينزل لحاله — ممنوع معه مواد */
function isInternship(c){
  const code=((c&&c.c)||'').toUpperCase(), name=((c&&c.n)||'').toUpperCase();
  return /\b(INTERN|COOP|CO-OP|TRAINING|PRACTIC)/.test(name) ||
         /^(INTR|COOP|TRAI)/.test(code) ||
         /\b(4399|4499|4999)\b/.test(code);
}

/* أول مستوى تحضيري ما خلّصه الطالب — التحضيري متسلسل، مستوى بعد مستوى */
function currentPrepSem(ctx){
  if(!ctx.prep)return null;
  return ctx.sems.find(sem=>sem.prep && !sem.courses.every(c=>isPassed(ctx,c.c))) || null;
}

/* المواد اللي لازم تنعاد: أخذها وما نجح — رسوب أو انسحاب.
   جديدة (ما كانت دالة مستقلة في الصفحة)، مبنية على isDone/isPassed
   نفسها اللي يستعملها المقترح، فما تغيّر أي نتيجة قائمة. */
function retakeList(ctx){
  return allPlanCourses(ctx)
    .filter(c=>isDone(ctx,c.c)&&!isPassed(ctx,c.c))
    .map(c=>({...c,why:isFailed(ctx,c.c)?'failed':'withdrawn',grade:ctx.grades[c.c]||null}));
}

/* ═══ المعدل ═══ */
function calcGPA(ctx){
  let pts=0,hrs=0,n=0;
  Object.keys(ctx.grades).forEach(code=>{
    const g=ctx.grades[code];
    if(!g||GRADE_SKIP.includes(g)||!(g in GRADE_POINTS))return;
    if(!isDone(ctx,code))return;
    /* درجات مواد مو في خطتك الحالية ما تُحسب — أكواد المواد تختلف
       بين التخصصات، فلو غيّرت تخصصك تبقى درجة قديمة تؤثر على معدلك
       وأنت ما تشوفها ولا تقدر تعدّلها. */
    if(!findPlanCourse(ctx,code) && !ctx.tech[code])return;
    const h=creditsOf(ctx,code);
    pts+=GRADE_POINTS[g]*h;hrs+=h;n++;
  });
  return {gpa:hrs?pts/hrs:null,hrs,n,pts};
}

/* المعدل المتوقّع — الطالب يحط تقديراً افتراضياً لمادة ما خلصها */
function calcProjected(ctx,whatIf){
  const w=(whatIf&&typeof whatIf==='object')?whatIf:{};
  const base=calcGPA(ctx);
  let pts=base.pts||0, hrs=base.hrs||0, n=0;
  Object.keys(w).forEach(code=>{
    const g=w[code];
    if(!g||!(g in GRADE_POINTS))return;
    if(isDone(ctx,code))return;              /* خلصها فعلاً — نتجاهل الافتراض */
    const h=creditsOf(ctx,code);
    pts+=GRADE_POINTS[g]*h; hrs+=h; n++;
  });
  return {gpa:hrs?pts/hrs:null,hrs,n};
}


/* ═══════════ جدول الطرح المعلن — الميكانيكال ═══════════
   الجامعة نشرت «semester-aligned offering plan» يحدد المواد التي
   **لن تُطرح** في كل ترم حتى 2028/2029. المهم فيه ليس المنع بل
   العكس: مادة لا تُطرح في الربيع تعني أن الخريف فرصتها الوحيدة،
   وتفويتها يؤخّر الطالب سنة كاملة لا ترماً.

   ملاحظة على الوثيقة: كُتب «MEEN 2313 Materials Engineering»
   و«MEEN 2313 Solid Mechanics» بنفس الرقم — خطأ مطبعي واضح،
   والصحيح 2311 للمواد و2313 للصلبة. صُحّح هنا.

   الترميز: آخر رقمين من كود الترم — 10 خريف · 20 ربيع · 30 صيف. */
const OFFER_MAJORS=['MEEN','MEEN_OLD'];   /* الجدول يخص الميكانيكال وحده */

/* ترم → المواد التي لا تُطرح فيه */
const NOT_OFFERED={
  '202620':['MEEN 2312'],
  '202710':['MEEN 2311','MEEN 2313'],
  '202720':['MEEN 2312','MEEN 3394','MEEN 3311','MEEN 3391','MEEN 3101'],
  '202810':['MEEN 2311','MEEN 2313','MEEN 3432','MEEN 3333','MEEN 3395','MEEN 3111'],
  '202820':['MEEN 2312','MEEN 3394','MEEN 3311','MEEN 3391','MEEN 3101',
            'MEEN 4393','MEEN 4392','MEEN 4322','ELEC 1'],
  '202910':['MEEN 2311','MEEN 2313','MEEN 3432','MEEN 3333','MEEN 3395','MEEN 3111']
};

/* الترم الذي يليه مباشرة — للسؤال: هل تُطرح المرة القادمة؟ */
function nextTermCode(code){
  const y=String(code).slice(0,4), k=String(code).slice(4);
  if(k==='10')return y+'20';                    /* خريف ← ربيع نفس السنة */
  if(k==='20')return y+'30';                    /* ربيع ← صيف */
  return (parseInt(y,10)+1)+'10';               /* صيف ← خريف السنة الجاية */
}
function offerKnown(code){ return Object.prototype.hasOwnProperty.call(NOT_OFFERED,String(code)) }
function notOfferedIn(code,c){ return (NOT_OFFERED[String(code)]||[]).includes(c) }

/* متى تُطرح المادة مرة أخرى؟
   نتخطى الصيف في العدّ: الجامعة ما تطرح مواد التخصص فيه عملياً،
   وما ذُكر في الوثيقة أصلاً — فعدّه «ترماً متاحاً» يعطي الطالب
   انطباعاً كاذباً بأن الفرصة قريبة. */
function skipAhead(ctx,courseCode){
  if(!OFFER_MAJORS.includes(ctx.major))return 0;
  let code=nextTermCode(ctx.term), n=0;
  while(n<6){
    if(String(code).slice(4)==='30'){ code=nextTermCode(code); continue; }  /* نتجاوز الصيف */
    if(!offerKnown(code) || !notOfferedIn(code,courseCode))break;
    n++; code=nextTermCode(code);
  }
  return n;
}

/* أول ترم قادم تُطرح فيه المادة */
function nextOffered(ctx,courseCode){
  let code=nextTermCode(ctx.term);
  for(let i=0;i<8;i++){
    if(String(code).slice(4)!=='30' &&
       (!offerKnown(code) || !notOfferedIn(code,courseCode))) return code;
    code=nextTermCode(code);
  }
  return null;
}

/* تحذير جاهز للعرض، أو فراغ. يرجع أكواد ترمات لا نصاً — الصياغة
   والترجمة في الصفحة. */
function offerWarn(ctx,courseCode){
  if(!OFFER_MAJORS.includes(ctx.major))return null;
  /* المادة المنتهية ما يهمّ متى تُطرح — والخطة مليانة منتهيات،
     فالتحذير عليها ضجيج يغطّي التحذير الذي يهم فعلاً. */
  if(isPassed(ctx,courseCode))return null;
  const now=ctx.term;
  if(notOfferedIn(now,courseCode)){
    return {kind:'none',next:nextOffered(ctx,courseCode)};
  }
  const n=skipAhead(ctx,courseCode);
  return n?{kind:'last',n,next:nextOffered(ctx,courseCode)}:null;
}

/* ═══ المقترح للترم الجاي ═══
   يرجع بيانات لا نصاً: prepSem معرّف الترم واسمه الخام، والصفحة
   تترجمه. أي تغيير في الترتيب هنا يغيّر ما يراه كل طالب. */
function suggestNext(ctx){
  const cands=[]; let intern=null;
  /* طالب التحضيري يشوف مستواه الحالي فقط.
     وفي المستوى المتقدم يقدر ينزل معه مواد من تخصصه. */
  /* ما يبدأ مقترح مواد التخصص إلا بعد ما يخلّص التحضيري كامل — يمنع الخربطة */
  const pSem=currentPrepSem(ctx);
  ctx.sems.forEach((sem,si)=>sem.courses.forEach(c=>{
    /* المادة اللي رسب فيها لازم يعيدها — تبقى في المقترح */
    if(isPassed(ctx,c.c)||c.el)return;   /* الراسب والمنسحب يبقيان في المقترح */
    if(c.adm)return;                 /* مواد تنزّلها الإدارة — الطالب ما يسجّلها بنفسه */
    if(c.prep && (!pSem || sem.id!==pSem.id))return;   /* مستوى التحضيري الحالي فقط */
    if(!c.prep && pSem)return;                         /* مواد التخصص تنتظر إنهاء التحضيري */
    if(!prereqCheck(ctx,c.c).ok)return;
    const item={...c,order:si,unlocks:unlocksCount(ctx,c.c),retake:isFailed(ctx,c.c)};
    if(isInternship(c)){
      /* ما نعرضه إلا لو وصل ساعات السينيور فعلاً */
      if(!intern && doneCredits(ctx)>=INTERN_MIN_CREDITS)intern=item;
      return;   /* وفي كل الأحوال ما ينزل ضمن المواد العادية */
    }
    cands.push(item);
  }));

  /* مستوى تحضيري كل مواده تنزّلها الإدارة — نوضّح بدل ما نترك فراغاً */
  const admOnly = !!pSem && !cands.length &&
    pSem.courses.every(c=>c.adm||isPassed(ctx,c.c));

  /* التطبيق العملي ينزل لحاله — ممنوع معه أي مادة */
  if(intern && !cands.length)
    return {crit:[intern],opt:[],hours:intern.h,internOnly:true};

  /* «آخر فرصة» تسبق «يفتح مواد»: تأخير مادة يفتح غيرها يكلّف ترماً،
     وتأخير مادة لا تُطرح الترم الجاي يكلّف سنة. الأثقل أولاً. */
  const lastChance=c=>{const w=offerWarn(ctx,c.c);return (w&&w.kind==='last')?1:0};
  cands.forEach(c=>{c.lastChance=lastChance(c)});
  cands.sort((a,b)=>(b.prep?1:0)-(a.prep?1:0)||(b.retake?1:0)-(a.retake?1:0)
    ||(b.lastChance-a.lastChance)||(b.unlocks-a.unlocks)||(a.order-b.order));
  const crit=[],opt=[];let hrs=0;
  /* مواد التحضيري أساسية دائماً وما يحدّها سقف الساعات */
  cands.filter(c=>c.prep).forEach(c=>{crit.push(c);hrs+=c.h});
  cands.filter(c=>!c.prep&&(c.retake||c.lastChance||c.unlocks>0)).forEach(c=>{if(hrs+c.h<=20){crit.push(c);hrs+=c.h}});
  cands.filter(c=>!c.prep&&!c.retake&&c.unlocks===0).forEach(c=>{if(hrs+c.h<=20){opt.push(c);hrs+=c.h}});
  return {crit,opt,hours:hrs,internAvailable:!!intern,admOnly,
          prepSem:pSem?{id:pSem.id,label:pSem.label}:null};
}

const LOGIC = {
  PREP_MATH, PREP_MATH_NAME, PREP_EXIT, PREP_GATE_LANG, PREP_GATE_MATH,
  FAIL_GRADES, FAIL_GRADES_C, WITHDRAW_GRADES, GRADE_POINTS, GRADE_SKIP,
  INTERN_MIN_CREDITS,
  hasAltPlan, planKey, planOf, prepSems, semesters, ctxOf,
  allPlanCourses, findPlanCourse, failGrades, isFailed, isWithdrawn,
  isDone, isPassed, doneCredits, level, prepGate, prepLevelLock,
  prereqCheck, creditsOf, unlocksCount, unlockedBy, isInternship,
  currentPrepSem, retakeList, calcGPA, calcProjected,
  OFFER_MAJORS, NOT_OFFERED, nextTermCode, offerKnown, notOfferedIn,
  skipAhead, nextOffered, offerWarn, suggestNext,
};

const DATA = Object.assign({ PLANS, PLAN_ALT, REG_CAL, GUIDE }, LOGIC);

/* Node يأخذها بـrequire، والمتصفح يعرّفها على window.
   البيانات تبقى على window كما كانت (كود الصفحة يناديها بلا بادئة)،
   والمنطق تحت اسم واحد PlanLogic حتى ما نزحم النطاق العام. */
if (typeof module === 'object' && module && module.exports) module.exports = DATA;
else {
  root.PLANS = PLANS; root.PLAN_ALT = PLAN_ALT; root.REG_CAL = REG_CAL; root.GUIDE = GUIDE;
  root.PlanLogic = LOGIC;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);
