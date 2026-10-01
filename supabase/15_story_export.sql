-- 15_story_export.sql (01-10-2026) — eenmalig: story-geschiedenis aanvullen uit de export van Meta Business Suite
-- (Insights → Content → Stories → Export data; 2 bestanden, 30-06 t/m 30-09-2026, 71 stories).
-- Waarom: de koppeling (API) geeft herdeelde stories nooit door, en de verzamelaar draait pas sinds 28-09.
-- Wat het doet:
--   1. kolom ig_story.bron: 'api' (koppeling), 'export' (alleen uit dit bestand), 'api+export' (allebei)
--   2. story die er al is (zelfde id, of geplaatst binnen 2 minuten): per cijfer het hoogste van de twee
--      (de export is de eindstand; onze laatste meting viel tot een uur te vroeg)
--   3. story die er nog nie is: erbij, met de cijfers uit de export
-- Tijden: de export geeft Los Angeles-tijd ("09/30/2026 13:01" = 30-09 22:01 bij ons); hieronder al omgerekend naar UTC.
-- Export geeft echte likes (géén total_interactions/tikte-weg); wel link_clicks, sticker_taps, navigation, duur_sec.
-- Dubbel draaien kan geen kwaad.

alter table public.ig_story add column if not exists bron text not null default 'api';

with x(media_id, gepost_om, permalink, bijschrift, c) as (values
('17998400882980641', '2026-07-01 03:05:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3931364073421172293', 'Captured
 @geenideemag', '{"views":291,"reach":221,"likes":7,"shares":0,"replies":0,"sticker_taps":6,"navigation":258,"duur_sec":15}'),
('18123684487666055', '2026-07-01 21:08:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3931909118571164291', '', '{"views":252,"reach":201,"likes":5,"shares":0,"replies":2,"navigation":215,"profile_visits":2,"duur_sec":25}'),
('17955813426159892', '2026-07-02 06:24:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3932188943525446473', 'Check it out here 😎 Almost weekend;
 Find Me 
released on Spotify
💚💛', '{"views":193,"reach":166,"likes":0,"shares":0,"replies":0,"navigation":177,"link_clicks":3,"duur_sec":18}'),
('18433244611131140', '2026-07-02 06:29:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3932191312065705395', '', '{"views":166,"reach":151,"likes":1,"shares":0,"replies":0,"navigation":156,"profile_visits":1,"duur_sec":7}'),
('18074511929680445', '2026-07-02 18:31:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3932555042108565585', 'Check this series AND more Holly smoke, you have #zeevonk and on an other planet you have @honkingelephant 
😎😎👊🏻😎😎', '{"views":218,"reach":166,"likes":5,"shares":0,"replies":0,"sticker_taps":9,"navigation":188,"profile_visits":3,"duur_sec":30}'),
('18116507905858144', '2026-07-04 11:14:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3933784594046528798', 'Day 1 being a #cityhost
💚💛 So much fun 😎', '{"views":404,"reach":323,"likes":21,"shares":0,"replies":2,"sticker_taps":2,"navigation":373,"profile_visits":3,"duur_sec":30}'),
('17957630385149391', '2026-07-05 17:09:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3934687957487528917', 'Nice one 
😎', '{"views":393,"reach":314,"likes":15,"shares":0,"replies":1,"navigation":340,"profile_visits":4,"duur_sec":28}'),
('18121473523745079', '2026-07-10 19:18:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3938376817740420540', 'Legends', '{"views":426,"reach":329,"likes":16,"shares":0,"replies":0,"sticker_taps":3,"navigation":374,"profile_visits":3,"duur_sec":59}'),
('17954998068190612', '2026-07-10 22:35:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3938476153195277768', 'On fire in
#thehague
💚💛', '{"views":385,"reach":292,"likes":14,"shares":2,"replies":1,"navigation":325,"profile_visits":2,"duur_sec":49}'),
('18098020073240927', '2026-07-11 07:46:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3938752943201564162', '#thehague skyline magic', '{"views":277,"reach":227,"likes":10,"shares":0,"replies":0,"navigation":244,"profile_visits":2,"duur_sec":15}'),
('17889402555581261', '2026-07-11 07:58:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3938759200591442830', '#beachlife mood
💚💛', '{"views":238,"reach":201,"likes":6,"shares":0,"replies":1,"sticker_taps":9,"navigation":220,"duur_sec":48}'),
('18147709237519104', '2026-07-11 22:23:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3939194797969732274', 'Kicke', '{"views":261,"reach":206,"likes":12,"shares":0,"replies":1,"navigation":229,"duur_sec":40}'),
('18192504598343979', '2026-07-12 19:32:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3939833495351390504', '💚💛', '{"views":263,"reach":215,"likes":11,"shares":4,"replies":0,"navigation":237,"profile_visits":3,"duur_sec":60}'),
('18007646489946902', '2026-07-13 16:50:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3940477290110812948', 'Holly smokes, what a party that was 💚💛 and what an #aftermovie 😎', '{"views":199,"reach":172,"likes":5,"shares":1,"replies":0,"navigation":182,"duur_sec":44}'),
('17961961973960980', '2026-07-15 05:47:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3941592208787251483', 'By now I have created quit a #playlist with some easy listening #beachlife #beachvibes from #thehague
💚💛 Will you give it a spin this #summer?', '{"views":304,"reach":245,"likes":1,"shares":0,"replies":0,"navigation":247,"profile_visits":4,"duur_sec":0}'),
('18104455463155075', '2026-07-16 10:51:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3942470460508017128', 'Who will be the local creator this weekend
😎', '{"views":220,"reach":169,"likes":3,"shares":0,"replies":2,"sticker_taps":5,"navigation":200,"profile_visits":2,"duur_sec":24}'),
('18132402799567544', '2026-07-19 19:39:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3944910369680376530', 'WoW', '{"views":284,"reach":229,"likes":7,"shares":0,"replies":0,"navigation":235,"profile_visits":2,"duur_sec":12}'),
('18089353562416876', '2026-07-29 11:04:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3951898831528759363', 'A CHILDHOOD PHOTO THAT COULD BE AN ALBUM COVER', '{"views":555,"reach":448,"likes":12,"shares":0,"replies":1,"navigation":496,"profile_visits":8,"duur_sec":31}'),
('18060634349520511', '2026-08-02 19:11:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3955042830233991850', '', '{"views":356,"reach":277,"likes":4,"shares":0,"replies":0,"navigation":319,"profile_visits":3,"duur_sec":30}'),
('18022529516691461', '2026-08-03 21:05:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3955825012875534309', 'That was a cool promo action 
🐟🐟🐟', '{"views":308,"reach":257,"likes":9,"shares":0,"replies":0,"sticker_taps":6,"navigation":270,"profile_visits":1,"duur_sec":26}'),
('18112143364766066', '2026-08-04 22:05:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3956579977445319703', 'The day the sky gave a pretty good show ⚡️⚡️⚡️', '{"views":1157,"reach":881,"likes":22,"shares":1,"replies":0,"navigation":539,"profile_visits":4,"duur_sec":15}'),
('17865485016645088', '2026-08-06 11:47:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3957718899625944446', '@demosrichard  @burgemeesterjanvanzanen  klein wetsvoorstel voor de komende gemeenteraad…

Kennûh we die duinûh nié wat ophóghûh?', '{"views":373,"reach":295,"likes":22,"shares":0,"replies":6,"sticker_taps":2,"navigation":308,"profile_visits":6,"duur_sec":13}'),
('17946995157252561', '2026-08-07 22:44:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3958773986485980361', 'How many aliens in this picture?', '{"views":304,"reach":251,"likes":17,"shares":0,"replies":3,"navigation":277,"profile_visits":1,"duur_sec":30}'),
('18106888640121904', '2026-08-08 12:48:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3959203197784789953', 'The only thing I miss in @thehague 🏔️', '{"views":378,"reach":302,"likes":14,"shares":0,"replies":2,"navigation":327,"profile_visits":1,"duur_sec":24}'),
('18089473781561144', '2026-08-12 23:03:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3962407704208450068', '', '{"views":482,"reach":348,"likes":26,"shares":0,"replies":0,"navigation":375,"profile_visits":5,"duur_sec":5}'),
('18085200119668631', '2026-08-13 08:56:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3962705814305474180', 'Thanks 🙏', '{"views":495,"reach":395,"likes":17,"shares":2,"replies":1,"sticker_taps":11,"navigation":247,"profile_visits":4,"duur_sec":5}'),
('18091386302194302', '2026-08-13 13:33:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3962845462122055631', 'Weekend ahead…perfect for my collection #chill #vibes I produced… #music from behind the #dunes of #thehague Also on Youtube:', '{"views":244,"reach":186,"likes":6,"shares":0,"replies":0,"navigation":209,"profile_visits":2,"link_clicks":1,"duur_sec":5}'),
('17922804777409732', '2026-08-14 12:20:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3963533418885384526', 'Mooiûh plaatjus op de achtergrond gooss😎😬😉
.Ja toch 💚💛👊🏻', '{"views":219,"reach":188,"likes":7,"shares":0,"replies":0,"navigation":181,"duur_sec":39}'),
('18114408881095449', '2026-08-19 18:31:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3967344157458780827', 'Truus is weer thuus 💚💛', '{"views":1259,"reach":974,"likes":28,"shares":2,"replies":4,"navigation":462,"profile_visits":5,"duur_sec":10}'),
('18106199603519494', '2026-08-20 22:12:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3968180184620595634', 'Is it already weekend 😎', '{"views":162,"reach":132,"likes":4,"shares":0,"replies":0,"navigation":138,"profile_visits":2,"duur_sec":9}'),
('18378322822224615', '2026-08-28 05:30:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3973473807612345458', 'Out of the running for a little while, hope to be out again soon 🥴', '{"views":518,"reach":397,"likes":15,"shares":0,"replies":10,"navigation":448,"profile_visits":5,"duur_sec":30}'),
('18113873957054108', '2026-09-03 06:15:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3977845463487201664', 'Fresh tunes from behind the dunes, ready for the weekend?', '{"views":268,"reach":206,"likes":5,"shares":0,"replies":0,"navigation":224,"profile_visits":4,"link_clicks":3,"duur_sec":7}'),
('18133387150718674', '2026-09-10 04:56:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3982878689280776193', 'Morning #thehague 
💚💛 These days are the best to capture #sunrises from the #vulkaan', '{"views":429,"reach":359,"likes":19,"shares":1,"replies":2,"sticker_taps":4,"navigation":338,"profile_visits":2,"duur_sec":30}'),
('17913202098461796', '2026-09-11 05:17:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3983614173044879368', 'Let’s go….', '{"views":208,"reach":167,"likes":3,"shares":0,"replies":1,"sticker_taps":2,"navigation":170,"profile_visits":1,"duur_sec":5}'),
('17978784558092477', '2026-09-11 09:27:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3983740257421857560', 'Damn nice coffee just around the corner 
 @beans.dreams', '{"views":447,"reach":341,"likes":4,"shares":1,"replies":0,"sticker_taps":10,"navigation":197,"profile_visits":1,"duur_sec":30}'),
('17904444915580955', '2026-09-13 18:38:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3985466949853101998', 'Playing outside again
💚💛', '{"views":483,"reach":380,"likes":4,"shares":1,"replies":0,"sticker_taps":15,"navigation":298,"profile_visits":2,"duur_sec":12}'),
('17977843179103889', '2026-09-15 06:57:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3986563914707867738', '', '{"views":308,"reach":244,"likes":16,"shares":1,"replies":3,"sticker_taps":7,"navigation":277,"profile_visits":2,"duur_sec":20}'),
('18459180898186232', '2026-09-15 07:12:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3986571474582805159', 'Yes I want that poster to 
💚💛', '{"views":286,"reach":213,"likes":11,"shares":0,"replies":1,"navigation":214,"profile_visits":1,"duur_sec":0}'),
('18121618726930129', '2026-09-15 20:35:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3986975404605139880', 'Let’s see what tomorrow brings, see ya at the #vulkaan?
💚💛', '{"views":320,"reach":250,"likes":9,"shares":0,"replies":0,"sticker_taps":8,"navigation":253,"profile_visits":2,"duur_sec":0}'),
('17873523468582941', '2026-09-16 05:17:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3987237937246230375', '', '{"views":290,"reach":223,"likes":6,"shares":0,"replies":0,"sticker_taps":8,"navigation":234,"profile_visits":1,"duur_sec":0}'),
('18210401704317891', '2026-09-16 09:18:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3987359385248421159', 'Magical mornings in September 
💚💛 This should be on a wall in a public building in #thehague somewhere…don’t you agree 😆😉', '{"views":270,"reach":211,"likes":22,"shares":0,"replies":0,"navigation":249,"profile_visits":2,"duur_sec":30}'),
('18154148209517206', '2026-09-16 21:27:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3987726305059503450', 'That’s a lot of work..
Nice 👊🏻', '{"views":159,"reach":141,"likes":8,"shares":0,"replies":0,"navigation":148,"duur_sec":23}'),
('18078429944650775', '2026-09-18 05:05:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3988681652972658029', 'Wh3r3 is the #sun
😵‍💫', '{"views":470,"reach":369,"likes":7,"shares":1,"replies":2,"navigation":265,"profile_visits":2,"duur_sec":30}'),
('17956376598015375', '2026-09-18 14:57:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3988979674797385591', 'Again no #sun, but great #timelaps by
 @noskos', '{"views":197,"reach":168,"likes":8,"shares":0,"replies":1,"navigation":171,"duur_sec":26}'),
('18125751046882801', '2026-09-19 12:01:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3989616025750307830', 'Creativity rampage
💚💛', '{"views":191,"reach":156,"likes":15,"shares":0,"replies":0,"navigation":168,"profile_visits":1,"duur_sec":15}'),
('18095978468533998', '2026-09-20 07:00:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3990189213622332528', '', '{"views":161,"reach":145,"likes":8,"shares":0,"replies":0,"navigation":149,"duur_sec":21}'),
('18078990299350541', '2026-09-23 06:16:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3992341097481052964', '', '{"views":310,"reach":234,"likes":10,"shares":0,"replies":0,"navigation":276,"profile_visits":6,"duur_sec":30}'),
('17989626486051528', '2026-09-23 20:24:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3992768122616351128', 'Tomorrow fresh music from #thehague
💚💛', '{"views":177,"reach":139,"likes":3,"shares":0,"replies":0,"navigation":160,"duur_sec":8}'),
('18630063382040063', '2026-09-24 06:01:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3993058831126831888', 'Morning #thehague
💚💛', '{"views":253,"reach":203,"likes":12,"shares":1,"replies":2,"sticker_taps":4,"navigation":178,"duur_sec":17}'),
('18128395414834900', '2026-09-24 15:54:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3993357218225175936', 'The planning
 @photopills 
👊🏻', '{"views":244,"reach":165,"likes":12,"shares":0,"replies":2,"sticker_taps":12,"navigation":183,"profile_visits":3,"duur_sec":7}'),
('18103952873214992', '2026-09-24 19:51:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3993476167864544318', 'Went home to early
😭', '{"views":221,"reach":156,"likes":12,"shares":0,"replies":1,"sticker_taps":2,"navigation":202,"duur_sec":14}'),
('17969773872172457', '2026-09-25 07:28:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3993827297144455484', 'When you are  recovering 😉', '{"views":1632,"reach":1253,"likes":2,"shares":4,"replies":0,"navigation":179,"link_clicks":10,"duur_sec":20}'),
('18097126268531930', '2026-09-25 10:35:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3993921297033571543', 'See ya in #scheveningen tomorrow', '{"views":186,"reach":144,"likes":5,"shares":0,"replies":1,"navigation":172,"duur_sec":14}'),
('17912219283286036', '2026-09-25 15:40:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3994074548194345109', 'On my way the the #vulkaankijkduin for an other one, let’s see what we get today
💚💛 Will I see you there? Show time at 19:00', '{"views":227,"reach":160,"likes":10,"shares":0,"replies":0,"navigation":153,"profile_visits":2,"duur_sec":5}'),
('17892322815612874', '2026-09-25 19:17:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3994183749566549393', '', '{"views":1204,"reach":939,"likes":6,"shares":4,"replies":0,"navigation":186,"profile_visits":1,"link_clicks":11,"duur_sec":15}'),
('18051822836590328', '2026-09-25 20:48:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3994229664989926314', 'Let’s go 💚💛', '{"views":168,"reach":131,"likes":1,"shares":0,"replies":0,"sticker_taps":5,"navigation":148,"duur_sec":5}'),
('17920861251226202', '2026-09-26 11:06:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3994661381717080207', 'Cool, keep ‘m coming
#moon and #skyline struck
💚💛', '{"views":224,"reach":171,"likes":8,"shares":0,"replies":0,"sticker_taps":9,"navigation":191,"duur_sec":0}'),
('18037520276649424', '2026-09-26 11:25:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3994671119814462071', 'Lot of activities today', '{"views":316,"reach":244,"likes":19,"shares":2,"replies":0,"sticker_taps":6,"navigation":180,"duur_sec":12}'),
('18093213479554823', '2026-09-26 12:03:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3994690116882600161', 'Lemmy Flaai with
 @rodney.malik', '{"views":299,"reach":215,"likes":7,"shares":1,"replies":1,"sticker_taps":16,"navigation":206,"duur_sec":30}'),
('18460708363140685', '2026-09-26 17:19:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3994849105071125261', 'More skyline shooters
💛💚', '{"views":225,"reach":177,"likes":4,"shares":0,"replies":1,"sticker_taps":2,"navigation":209,"profile_visits":1,"duur_sec":30}'),
('18140178637612301', '2026-09-27 06:04:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3995234447322326300', 'Rocking 🤘🏻', '{"views":232,"reach":191,"likes":3,"shares":0,"replies":0,"sticker_taps":4,"navigation":217,"profile_visits":1,"duur_sec":19}'),
('17896403337405976', '2026-09-27 13:31:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3995459415729882460', 'After a hectic fantastic day at #scheveningen yesterday…chilling @bariloche_beach', '{"views":1180,"reach":929,"likes":11,"shares":1,"replies":0,"sticker_taps":2,"navigation":250,"profile_visits":1,"duur_sec":30}'),
('17937796866368799', '2026-09-27 17:03:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3995566227900399859', 'For super nice #droneshots of #thehague, check out

 @rodney.malik 🤘🏻

💚💛', '{"views":396,"reach":316,"likes":5,"shares":1,"replies":1,"sticker_taps":4,"navigation":252,"profile_visits":1,"duur_sec":53}'),
('18378814120233186', '2026-09-29 09:20:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3996782708063591324', 'Stunning', '{"views":226,"reach":183,"likes":13,"shares":0,"replies":0,"navigation":206,"profile_visits":2,"duur_sec":54}'),
('18336308899257871', '2026-09-29 20:46:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3997127971416387296', 'What an amazing night in #thehague
💚💛 May #summer last forever 👊🏻', '{"views":184,"reach":149,"likes":12,"shares":0,"replies":1,"sticker_taps":2,"navigation":167,"profile_visits":1,"duur_sec":23}'),
('18110520956118735', '2026-09-29 20:48:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3997128759719048780', 'Thanks @liz_shotz 😘', '{"views":176,"reach":132,"likes":8,"shares":0,"replies":1,"sticker_taps":4,"navigation":161,"duur_sec":15}'),
('17909491164501484', '2026-09-29 22:06:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3997168307677266148', '', '{"views":222,"reach":163,"likes":2,"shares":1,"replies":0,"navigation":144,"link_clicks":6,"duur_sec":14}'),
('18134945299653390', '2026-09-29 22:18:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3997174355981048998', '', '{"views":228,"reach":175,"likes":0,"shares":1,"replies":0,"sticker_taps":5,"navigation":135,"duur_sec":30}'),
('18020901107926153', '2026-09-30 11:27:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3997571182362455571', 'Thanks 👊🏻', '{"views":131,"reach":103,"likes":2,"shares":0,"replies":0,"navigation":114,"duur_sec":5}'),
('18164862244484641', '2026-09-30 12:35:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3997605570882155645', 'This one should be all over the country
 (and In English all over the world)
 ✌🏻', '{"views":154,"reach":123,"likes":10,"shares":1,"replies":1,"navigation":118,"link_clicks":3,"duur_sec":30}'),
('18024256664879260', '2026-09-30 20:01:00+00', 'https://www.instagram.com/stories/the_hague_beachlife/3997830143456853977', 'Thanks for the inspiration @liz_shotz  After the rain today…
Hunting this weekend', '{"views":97,"reach":86,"likes":2,"shares":1,"replies":0,"navigation":60,"duur_sec":15}')
),
x2 as (
  select x.media_id, x.gepost_om::timestamptz as gepost_om, x.permalink, x.bijschrift, x.c::jsonb as c from x
),
-- koppelen: zelfde id, anders de dichtstbijzijnde story binnen 2 minuten (de export heeft geen seconden)
koppel as (
  select distinct on (s.media_id) s.media_id as s_id, x2.media_id as x_id
    from public.ig_story s
    join x2 on s.media_id = x2.media_id or abs(extract(epoch from s.gepost_om - x2.gepost_om)) < 120
   order by s.media_id, (s.media_id = x2.media_id) desc, abs(extract(epoch from s.gepost_om - x2.gepost_om))
),
m as (
  select x2.*, k.s_id from x2 left join koppel k on k.x_id = x2.media_id
),
bij as (
  update public.ig_story s
     set cijfers = s.cijfers || (select jsonb_object_agg(e.k, greatest(coalesce((s.cijfers->>e.k)::numeric, 0), e.v::numeric))
                                   from jsonb_each_text(m.c) e(k, v)),
         bijschrift = coalesce(s.bijschrift, m.bijschrift),
         bron = case when s.bron = 'api' then 'api+export' else s.bron end
    from m
   where s.media_id = m.s_id
  returning s.media_id
),
nieuw as (
  insert into public.ig_story (media_id, ig_id, soort, gepost_om, permalink, cijfers, laatst_gemeten_om, bijschrift, bron)
  select m.media_id, (select ig_id from public.ig_account order by bijgewerkt_om desc nulls last limit 1),
         '', m.gepost_om, m.permalink, m.c, now(), m.bijschrift, 'export'
    from m
   where m.s_id is null
  on conflict (media_id) do nothing
  returning media_id
)
select (select count(*) from x) as in_bestand, (select count(*) from bij) as bijgewerkt, (select count(*) from nieuw) as toegevoegd;

-- Uitkomst (aparte opdracht: in dezelfde opdracht zie je de wijzigingen nog nie). Verwacht: 71 stories totaal.
select to_char(s.gepost_om at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI') as geplaatst,
       s.bron,
       s.cijfers->>'reach' as bereik,
       s.cijfers->>'likes' as likes,
       left(coalesce(s.bijschrift, ''), 40) as tekst,
       (select count(*) from public.ig_story) as totaal_stories,
       (select count(*) from public.ig_story where bron = 'export') as alleen_export
  from public.ig_story s
 where s.gepost_om > '2026-09-27'
 order by s.gepost_om desc;
