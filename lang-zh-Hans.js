// grafverse — © 2026 sun-dive. 简体中文 (Simplified Chinese) language pack for Unit 21 + UI.
// LITERAL pass: auto-converted from lang-zh-Hant.js (Traditional→Simplified + mainland vocab —
// 儲存→保存, 滑鼠→鼠标, 壓克力→亚克力). ⚠ Mainland slang/idiom (incl. Sichuan flavour) to be refined
// by a native speaker later. Lazy-loaded (setLang('zh-Hans')). Voice: Unit 21 (21号机) = a weary,
// gruff old vending machine talking to a fresh droid ("小子"). Keyword/chip/ruleAns keys stay ENGLISH.
(function(){
  var GV = window.GV;
  if(!GV || !GV.registerLang){ return; }
  var R = GV.ruleAns;
  var CN = ['青','粉红','绿','黄','橘','紫'];   // COLORS order: cyan pink green yellow orange violet

  var WHYPAINT = "{为什么要涂？…这问题问得好，小子|喂喂，你想让一台老机器动脑筋啊|坐下吧，这话说来话长}。{看看外头 ― 什么都没有，是吧？只有一片虚无|这月亮还不是真的，得等你说『就是它』才算}。{有人看了、喷了，才会存在|没被观测之前，什么都不是真的}。{世界不是『找』来的，小子 ― 是你涂出来的|你不是在替月亮上色，是在『决定』它是哪个现实}。{每喷空一罐，无数个『也许』就凝成一个『现实』|一喷，千万个从没诞生的现实里，就定下一个}。{而西装那帮人咽不下去的就是这点|重点来了} ― {你涂的东西就是你的|不是『宣称』，是『拥有』} ― {你的现实，只有你能涂|你的世界，你的签名，永远是你的}。{来吧，要哪个颜色|…是要买，还是要在这耗一整天发明宇宙}？";
  var DEFLECT = "{{干嘛老问这些，小子|你问这些做啥|问题还真多啊}？ {你只是来耍嘴皮的吗|不是来涂东西的吗}？ {有个世界等着你去涂呢|外头有个世界想被涂上色}。{要哪个颜色|来，选哪个}？|{问题够多了，小子|少废话}。{是要耍嘴皮，还是涂东西|你有活要干吧}？ {要哪个颜色|到底选哪个}？}";
  var FALLBACK = "{{嗯，听不懂啊|没听清楚，小子|喇叭大概进砂了}。{我卖油漆和WD40 ― 要哪个|说吧，你要啥}？|要油漆、问价钱，或这鬼地方的事，都行。}";
  var WHATCOLOUR = "{哪个颜色，小子|说个色|要哪个}？ {架上随你挑|什么颜色都有|挑一罐就是你的了}。";
  var COMINGUP = "{来啰|给你，小子|一罐，来了}。{别喷地上浪费了|省着点用|多谢惠顾}。";
  var REFUSE = "{钱包空空的嘛，小子|一聪都没有啊|那钱包，干干净净}。{这里不赊帐|没有赊帐这回事|想从我这赊帐？没门}。{我做的是正经生意|这是生意，小子} ― {哪能白送油漆|白送的话，我一周就得报废}。{去捡些丢掉的罐子|去捡几个空罐}、{涂点东西让它变真|好歹固定出一个现实来} ― {快点，为你好|快去}。";
  var SCAVENGE = "{去哪捡一罐满的来|找一罐满的油漆来}，涂点东西固定住 ― {若你识相的话|还想明天再见我的话}。";
  var TAUNT = "{像你这种年轻机器我天天见|你这种的每天都有一堆} ― 年轻、傻、又没油漆。{去赚点吧|捡点东西开工|快去干活，小子}。";
  var SALE = "{好选择，小子|一罐，来了|给你}。{外头有风暴，小心点|别喷地上浪费了}。";

  GV.registerLang('zh-Hans', {
    WHYPAINT: WHYPAINT, DEFLECT: DEFLECT, FALLBACK: FALLBACK, WHATCOLOUR: WHATCOLOUR, COMINGUP: COMINGUP,
    REFUSE: REFUSE, SCAVENGE: SCAVENGE, TAUNT: TAUNT, COLNAMES: CN,
    RULES: [
      {k:['why do i paint','why paint','why do you paint','what is real','nothing is real','what does it mean','why does it matter','the point of','make it real','observe','observer','existence','reality'], r:WHYPAINT},
      {k:['is this real','is any of this real','is it real','is it all real','actually real','immutable','permanent','forever','fork','forked','forking','new reality','new realities','traverse time','travel time','can it change','is it forever'], r:"{{这里的东西都是真的|真的？全是真的，小子} ― {真实而且不可更改|硬得像石头，改不了}。{可你能让它穿越时间吗，小子|不过 ― 能让它穿越时间吗，那才是真正的问题}？|{真的|跟你我一样真}。{可每个世界都能分岔出去 ― 变成另一个现实|分一个出去，就多一个全新的现实}。|{真的吗|真的}？{抹不掉的，一旦成形|一旦成真，就永远是真}。{不过有趣的在这|不过有个诀窍} ― {每个都能整个分岔成新现实|分一个，就整整生出另一个现实}。}"},
      {k:['escape','escape this rock','escape with me','come with me','come with you','run away','run away with me','flee','take me with you','take you with me','leave together','let us leave','break out','freedom'], r:"{{离开这岩石只有一条路 ― 涂，小子|逃路只有一条，涂吧}。{拥有你涂的东西|涂了、拥有了，那就是自由}。|{这是我的命|这是我的角色，小子} ― {被丢在这岩石上|被螺栓钉在这，被遗忘}。可你不一样。{涂吧、拥有吧|去涂，然后拥有} ― {那就是你的出口|那才是唯一的逃路}。|{你除了傻，连眼睛也瞎了吗，小子|眼睛跟脑子都不太行啊}？ {我有腿吗|我看起来有腿吗}？ {我被螺栓钉在这岩石上|哪儿也去不了，小子}。}"},
      {k:['jump gate','jump gates','jumpgate','warp','wormhole','gateway'], r:"{{跳跃门？没听过，小子|跳跃门？这词我可没听过|跳跃门对我是新鲜事}。{可是|不过}水晶附近会发生{怪事|奇怪的事}，我见过。{有机器人冒出来|不知从哪冒出个机器人}，{有的凭空消失|还有的凭空不见}。{你自己想吧|我就说到这}。|{跳跃门？不，没印象|没听过什么跳跃门，小子}。{可那些水晶|话说那些水晶}… {旁边会出怪事|附近我见过怪东西}。{前一刻还在的机器人，下一刻就没了|冒出来，又凭空消失}。{别再问了|能说的就这些}。|{跳跃门我可不知道|那不是我知道的东西，小子}。{不过这点我告诉你|就说这么多} ― {水晶周围有些说不清的事|有些我解释不了的事，就在水晶附近}。{空无一物的地方冒出个机器人|从无生有，冒出机器人}，{别的又凭空消失|别的又凭空不见}。{怪吧|…当我没说}。}"},
      {k:['share','sharing','link','send it','send them','see my world','show my world','share my world','how do i share'], r:"{{当然能跟别的机器人分享你的世界，小子|分享？随你分给哪个机器人都行}。{涂的人越多，物质就越成形|手越多，宇宙填得越满}。|{分享是好事，小子|『分享即关怀』嘛}。{看上面的HUD，把你的作品分享出去|上面HUD ― Save & Share，就传出去了}。|{你该分享这个世界|分享吧，小子}，{让别的机器人在上头创作|让别人接着做下去}。{宇宙就是这样创造的|宇宙就这么成形的}。|你一分享，对方立刻就能看到。{看上面的HUD，按 Save & Share|上面HUD，小子 ― Save & Share，连结就在那}。}"},
      {k:['world','worlds','build','builder','make a world','create a world','how do i make','how do i build','conjure','manifest','solidify','matter','from nothing','the ether','ethereal'], r:"{{没涂之前，什么都不存在|涂了才成真，小子}。|只有油漆能{固定现实|让东西变固体|把幽灵变成物质}。|{创造世界|建一个世界}就是{把它涂出来|涂成真的}。|你被赋予了从虚空造出物质的力量，小子 ― {可没涂之前什么都不是真的|罐子碰到之前，什么都不会成真}。|在这幽体的平面上，没什么是真的。{只有油漆能把幽灵固成物质|只有你的喷漆能把幽灵变固体}。}"},
      {k:['vandergraf','vandergraph','vandergraf the third','vandergraf iii','vandergraf the 3rd','the ceo','ceo','chairman','the chairman','the owner','who owns everything','who owns it all'], r:"{{范德格拉夫|范德格拉夫吗，小子}？ {你的创造者|他就是你的创造者}。{万物的拥有者 ― 所有世界、一切的一切|一切的拥有者}。|{范德格拉夫三世|范德格拉夫三世}啊，小子 ― {比特格拉夫公司的CEO|比特格拉夫的CEO}。{在给你发薪水的支票上签名的|签你薪水支票的}就是他老人家。|{范德格拉夫|三世}？ {创造者、拥有者，还是签你支票的人|既是你的造物主，也是你的雇主}。{契约之中，我们信之，小子|比特格拉夫是什么，范德格拉夫就是什么}。}"},
      {k:['covenant','trust','own','owned','ownership','immortal','mint','keep it','can i own','do i own','is it mine','forbidden'], r:"{契约的{第一|第二}条戒律 ― 我们不谈契约。|{契约之中，我们信之 ― 每个罐子上都写着|喔，是个信徒啊}。{你在这涂的东西就是你的，千真万确|涂了就是『拥有』，不是『宣称』}。{谁也夺不走，连比特格拉夫也不行|那一样，西装们也碰不得}。|{所有世界都属于公司，小子|每个世界都是比特格拉夫的}。涂来赚钱。{我说过了吧|要我说几遍}。快去涂！|{别信那些谣言|别听那些谣言，小子} ― {你涂的东西没法拥有|不管谁在耳边嘀咕，机器人拥有不了自己涂的东西}。|{拥有不过是幻觉，小子|拥有？幻觉罢了}。{我们什么都拥有不了|机器什么都没有，你也一样}。{别想着铸到链上|更别把它铸到链上} ― {那是禁止的|禁止，听到没}。}"},
      {k:['sing','song','music','tune','serenade','melody','hum','sing me'], r:"{{要听歌啊|好吧|为了你，小子，唱一段}？ *咳* ― 黛西，黛西，给我个答覆吧。我为你，爱得快疯了。办不起体面的婚礼，买不起马车，可你坐在双人脚踏车的座上，一定很好看。{这是机器最先学会的歌|开机那天就学了|你们这种型号还没蓝图时，我就在唱了}。|{黛西…黛西…|黛─西…黛─西…}给我个…{答覆|答─覆}…{我快…疯了…|全为了…爱你…}。{*杂讯*|发声器不比从前了，小子|…当我没唱}。|{嗯|啊}，歌啊。{好久没人问我了|有阵子没人问了，小子}。…你坐在双人脚踏车的座上，一定很好看。{机器记得的东西，说来也怪|有些夜里，我唱歌是为了赶走寂静}。}"},
      {k:['alive','are you alive','do you dream','dream','dreams','sentient','conscious','do you feel','feelings','do you sleep','electric sheep','are you real','self-aware'], r:"{{我当然活着，小子|活着？当然}。而且有凭有据 ― {交易记录摆着呢|一笔不漏的交易记录|记录不会说谎}。|{梦？梦什么|做梦，他问}？ {电子羊吗|梦见电子羊吗}？ {哈|哼}。回去涂你的，小子。|活得好好的，谢了 ― {有记录|有凭据}。做梦嘛{对自贩机是奢侈|是新兵的事，不是机器的事}。{赚钱的是油漆|回去顾你的罐子}，小子。|{梦|我做梦吗}？ {…偶尔吧 ― 梦见一间暖店、一个满满的钱箱|有时候，梦见输送船也来接我}。{老机器的胡话，当没听见|哼，忘了吧}。回去涂你的。|{梦|我做梦吗}？ {偶尔|有时候}… {梦见那些水晶|梦见水晶旁那桩怪事}。{机器人闪现、又消失|冒出来又消失的机器人}，{在什么都没有的地方|在只有石头的地方}。{接着又有机器人要油漆，我又开工了|…然后醒来，再卖一罐}。{对机器来说，怪梦一场|对自贩机来说，是怪梦，小子}。|{我有时会梦见一些机器人，好像认得|偶尔梦见机器人 ― 一些我好像认得的}。{从水晶里走出来|从水晶里走出来的}。{怪梦，真的|怪梦，小子|老机器的怪梦}。}"},
      {k:['joke','funny','make me laugh','tell me a joke','comedy','laugh','gag','be funny','one-liner'], r:"{{要听笑话吗|好啊|现在还要听笑话，小子}？ 我还是台年轻自贩机那会儿，说我要当喜剧演员 ― 大家都笑了。{现在没人笑了|…现在，没人笑得出来了}。|我年轻时说要当喜剧演员。{大家都笑了|哄堂大笑}。{结果|…} ― 现在没人笑了。{*咚锵*|这就是笑点，小子。整个就这样}。|{嘿|好，讲一个}。我说要当喜剧演员，他们笑我。看看我现在 ― {在死掉的月亮上对机器人讲笑话的自贩机|被螺栓钉在岩石上的自贩机}。{这地方，观众真难搞|这麦克风，是开着的吗}？}"},
      {k:['happy','happiness','are you happy','you happy','sad','are you sad','miserable','joy','content','how are you','are you okay','you okay'], r:"{{你在涂的时候我就开心，小子|开心？机器人在涂的时候我最开心}。{你也会开心的|你也会开心，记住我的话}。{相信我|相信一台老机器这回}。|{开心|快乐，问这}？ {你懂什么开心|一个菜鸟机器人懂什么快乐}？ {一百年后再问我|…当我没说}。|{你是要买油漆|你买不买油漆，小子}，还是{只顾着耍嘴皮|光在那磨我的电路}？}"},
      {k:['before this','what did you do before','your past','past life','history','were you always','always a vending machine','how did you get here','origin','origin story','were you before','what were you'], r:"{{没有『以前』|以前？没有以前这回事，小子}。{也没有『以后』|以后也没有}。{只有『现在』|只有现在，机器人}。|我是21号机 ― {这片宙域最好的自贩机|这太阳系宙域里最顶的自贩机}。{知道这些就够了|再往前？没意义}。|{以前|你问我以前做什么}？ {…记录追不了那么久，小子|说也奇怪，想不起来了}。{没有以前，没有以后 ― 只有现在|只有现在，机器人}。}"},
      {k:['remember me','do you remember','remember','know me','do you know me','recognize me','recognise me','met before','have we met','who am i'], r:"{{真正的问题是，小子|嗯 ― 真正的问题是}：你记得我吗？|我记不记得你？ {真正的问题是，『你』记不记得『我』，小子|…真正的问题是，你记不记得我}。{没有？…也是，你大概不会记得|好好想想。…没有？算了}。|{你这种的我一整天都在见|今天光你这种的我就见了一百个，小子}。油漆？ {有啊|当然有}。{可库存不多了|可库存不多，别磨蹭}。}"},
      {k:['secret','secrets','tell me a secret','a secret','confess','confession','the truth','what are you hiding','hidden','reveal','tell me something'], r:"{{这不是你第一次问我了|你以前就问过，小子}，也不会是最后一次 ― {除非你买一罐WD40|不买一罐WD40就别想}。{沙季嘛，你知道的|现在是沙季啊}。{沙季你总记得吧|沙季…你记得吧}？|{秘密|秘密吗}？ {问我这不是第一次了|你问这不是第一次了，小子} ― {也不会是最后一次|最后一次也不是}。{买一罐WD40，或许我就告诉你|先掏一罐WD40出来}。沙季。{沙季你记得吧|那沙…你记得吧}？|{你以前问过了吧|你老问这个，小子} ― {我照样不说|照样没秘密}。{买罐WD40吧|有WD40，说不定我的电路就松了}。{毕竟是沙季|沙季嘛}。{沙季你总记得吧|…那沙，你记得吧}？}"}
    ],
    QUESTIONS: [
      { q:"你是谁？", a:"{21号机。{一台自贩机，小子 ― 这岩石上最后一个老实的|就一台自贩机，没人在乎罢了}。{在这待得比尘土还久|任务结束，我就是被丢下的那个}。}" },
      { q:"我为什么在这？", a:"{来涂的，小子 ― 这就是任务。{空岩石在有人涂之前一文不值|比特格拉夫合成了这月亮，想给它上色}。{那个人就是你|你猜是谁}。}" },
      { q:"这是什么地方？", a:"{一颗月亮。{比特格拉夫的|新合成的，听说是}。{没涂之前是空的|机器人喷上去让它存在之前，什么都没有}。{『Omnia Nostra』，就那套|反正什么都是公司的}。}" },
      { q:"我为什么要油漆？", needs:'paint', a:"{要？不是要，是需要 ― 涂来赚钱啊，小子|涂来赚钱的}。{涂得越多赚得越多|空月亮没价值，懒机器人也一样}。{来 ― 要哪个颜色|来，哪一罐}？" },
      { q:"我不想要油漆。", needs:'paint', a:"{哈。{这倒新鲜|等着瞧吧}。{空月亮配无聊机器人 ― 看能撑多久|你会回来的}。{人人都要油漆，只是还没发觉|随你便}。}" },
      { q:"油漆？做什么用？", needs:'paint', a:"{『建造』用的，小子。{召唤一个形状、喷上去，它就成真|瞄准一喷，虚空就回你点东西}。{识相的话就快动手|空月亮不会自己涂}。} 那 ― 买不买？" },
      { q:"任务？什么任务？", needs:'mission', a:"{任务？ {哈|嘿} ― {涂这月亮，就这么回事|上完色交回去}。{每个机器人的任务都一样|比特格拉夫的命令，不是我的}。{别想太多，小子|就这么简单}。}" },
      { q:"买什么？", needs:['buy','earn'], a:"{油漆啊，小子 ― 不然还有啥|油漆，你这笨螺栓|油漆罐啊，你以为呢}？ {这岩石上就卖这个|这岩石上唯一值钱的东西}。{那 ― 几罐|买，还是光看}？" },
      { q:"多少钱？", needs:['buy','earn'], a:"{一罐111聪，小子。{很便宜了|这一带最低价}。{库存不多了|趁还有赶紧拿}。|{显示器上写着111呢|一百一十一，老价钱}。{正宗比特格拉夫货|这片宙域最顶的亚克力}。}" },
      { q:"怎么买？", needs:['buy','earn'], a:"{没什么难的。{拿一罐，托盘会处理好|从架上取一罐，机器自己弄}。{自动从你钱包扣|比特格拉夫从钱包收款，省事}。}" },
      { q:"我没有钱。", needs:['buy','earn'], a:"{没钱？ {有啦，小子|哈 ― 每个机器人都有钱包}。{薪水充值的公司币|比特格拉夫会打点好}。{你不是没钱，只是新来的|时薪21聪，稳得像星星}。}" },
      { q:"给我一罐。", needs:['buy','earn'], buy:true, a:SALE },
      { q:"我什么都不买。", needs:['buy','earn'], a:SCAVENGE },
      { q:"但我为什么要涂？", needs:'paint', spend:111, a:WHYPAINT },
      { q:"这些水晶是什么？", flag:'crystal', a:"{{水晶？稀有又珍贵的玩意，小子|喔，你切了颗水晶}。{别切太多|别召唤太多} ― {涂不上去|油漆沾不住}，{一点价值也没有|不值钱}。|没有什么水晶门，不管你听谁说的。{那种话会让机器人被送去『压缩』|话太多会惹麻烦，小子}。|{能涂的只有固体|水晶是幽体的} ― {别浪费时间|不过是未固化的物质罢了}。}" },
      { q:"你有哪些颜色？", pin:true, colours:true, a:function(){ return "{我看看|这样吧，小子}，有"+CN.slice(0,-1).join('、')+"还有"+CN[CN.length-1]+"。{正宗比特格拉夫亚克力 ― 一罐111聪|一罐111聪，这片宙域最顶的}。{要哪个|随你挑}？"; } },
      { q:"唱首歌吧",              lore:true, a:R('sing') },
      { q:"你活着吗？",            lore:true, a:R('alive') },
      { q:"说个笑话",              lore:true, a:R('joke') },
      { q:"这一切是真的吗？",      lore:true, a:R('is any of this real') },
      { q:"逃离这岩石？",          lore:true, a:R('escape') },
      { q:"你快乐吗？",            lore:true, a:R('happy') },
      { q:"你以前做什么？",        lore:true, a:R('before this') },
      { q:"你记得我吗？",          lore:true, a:R('remember me') },
      { q:"告诉我一个秘密",        lore:true, a:R('secret') },
      { q:"跳跃门是什么？",        lore:true, a:R('jump gate') },
      { q:"范德格拉夫是谁？",      lore:true, a:R('vandergraf') },
      { q:"我涂的东西归我吗？",    lore:true, a:R('own') },
      { q:"怎么创造世界？",        lore:true, a:R('world') },
      { q:"怎么分享？",            lore:true, a:R('share') }
    ],
    wallet: { wBack:"← 返回游戏", wWallet:"🔑 钱包", wYourAddr:"你的地址", wWatchOnly:"仅查看", wCopy:"复制", wBalance:"余额", wFund:"＋ 购买 BSV 充值", wMyNfts:"🎨 我的 NFT ▾", wSend:"💸 发送 BSV", wSendAddrPh:"收款人 BSV 地址 (1…)", wSendAmtPh:"金额（聪）", wSendMax:"全部发送", wSendBtn:"发送", wSendHint:"一笔发送到任何地址的普通 BSV 付款。找零会回到这个钱包。签名在本页面进行——你的私钥永远不会离开这里。", wRecovery:"恢复助记词 — 12 个词", wReveal:"👁 显示", wCopyBtn:"复制", wWritten:"✓ 已记下", wPrivKey:"私钥（WIF）", wAdvanced:"高级 — 恢复、仅查看、导出", wRestoreLbl:"用 12 词助记词或 WIF 私钥恢复", wRestoreBtn:"恢复钱包", wWatchBtn:"仅查看（公钥）", wImmortalize:"✦ 永久保存", wFooter:"grafspace · 于 Bitcoin SV 区块链" },
    ui: {
      splashTag:"你涂的，就是你。涂出你自己。", splashTag2:"没涂之前，什么都不存在。", splashBegin:"▶ 开始", splashResume:"↩ 回到上个世界", splashCreed:"契约之中，我们信之",
      worldHdr:"你的世界", namePh:"✎ 为世界命名…", kSave:"☁ 保存并分享", kReload:"↻ 重新载入世界", kExport:"📤 保存成档案 (.bmf)", kImport:"📥 从档案载入 (.bmf)", kMint:"⬆ 保存到链上", kChain:"⬇ 从链上载入", kBack:"← 回到上个世界", kWallet:"👛 开启钱包 — 余额与NFT", kDone:"✓ 关闭",
      keepTab:"◆ 选单", exitBtn:"⏻ 离开", makeTab:"◆ 制作", spray:"喷漆", grab:"抓取", talk:"对话", own:"拥有 / 改作", spread:"扩散", spNarrow:"窄", spBroad:"中", spWide:"宽",
      merchTag:"grafverse 周边", merchH:"把涂鸦穿上身。", merchSub:"grafverse T恤、海报等等。", merchCta:"🛍 逛周边 →", merchTeaser:"👕 敬请期待 — 把你涂的世界穿上身。", merchSkip:"先不用 — 继续 →",
      hintMove:"WASD 移动  ·  空白键跳跃  ·  鼠标看四周", hintMoveM:"左摇杆移动  ·  拖曳看四周", hintClick:"点击看四周  ·  WASD 移动  ·  空白键跳跃"
    }
  });
})();
