const { source } = require('./sources/ru.senkuro/index.js');
const card = (s, r='GENERAL', st='ONGOING') => ({ slug: s, originalName:{lang:'EN',content:'O'+s}, titles:[{lang:'RU',content:'T'+s}], status: st, rating: r, cover:{original:{url:'https://c/'+s}} });
let calls = [];
const ctx = {
  cookies: Promise.resolve({ access_token: 'abc', x: '1' }),
  request: {
    async post(url, init) {
      const { query, variables } = JSON.parse(init.body);
      calls.push({ q: query.trim().split('\n')[0], v: variables, cookie: init.headers.Cookie });
      const json = async () => {
        if (query.includes('Browse')) {
          const n = variables.after ? Number(variables.after) : 1;
          return { data: { mangas: { edges: [1,2].map(i=>({node: card(`m${n}-${i}`, i==1?'EXPLICIT':'GENERAL')})), pageInfo: { hasNextPage: n<4, endCursor: String(n+1) } } } };
        }
        if (query.includes('Popular')) return { data: { mangaPopularByPeriod: [card('p1')] } };
        if (query.includes('Recommendations')) return { data: { mangaRecommendations: [] } };
        if (query.includes('Search')) return { data: { search: { edges: [{node: {...card('s1'), originalName:'Orig'}}] } } };
        if (query.includes('MangaChapters')) return { data: { mangaChapters: { edges: [{node:{slug:'c1',teamIds:['t1'],name:null,number:'1',volume:'1',createdAt:'2024-01-01T00:00:00Z'}}], pageInfo:{hasNextPage:false,endCursor:null} } } };
        if (query.includes('Manga(')||query.includes('query Manga')) return { data: { manga: { ...card('x'), mainStaff:[{person:{name:'A'},roles:['AUTHOR']},{person:{name:'B'},roles:['ARTIST']}], labels:[{slug:'l',titles:[{lang:'RU',content:'Экшен'}]}], branches:[{id:'b',primaryBranch:true,teamActivities:[{team:{id:'t1',name:'Team'}}]}] } } };
        if (query.includes('Reader')) return { data: { mangaChapter: { pages: [{number:2,image:{original:{url:'https://i/2',width:10,height:20}}},{number:1,image:{original:{url:'https://i/1'}}}] } } };
      };
      return { status: 200, json, text: async()=>'' };
    },
    async get() { const { parse } = require('node-html-parser'); return { status:200, url:'https://senkuro.me/', html: ()=>parse('<div class="main-section"><h3 class="caption">Последние обновления</h3><div class="card-new"><a class="card-cover" href="/manga/foo/chapters"></a><a class="card-new__status" href="/manga/foo/chapters/12abc"></a><h3 class="card-title">Foo</h3><div class="card-new__info">Глава 12 + x</div></div></div><meta name="description" content="Desc"><div class="project-stats__body"><div class="project-stats__text">Формат</div><div class="project-stats__name">Вебтун</div></div>') }; },
  },
};
(async()=>{
  console.log(JSON.stringify(await source.getHome(ctx)).slice(0,600));
  console.log('search', JSON.stringify(await source.getSearchMangaList({query:'a',page:1,filters:[]},ctx)));
  console.log('browse p2', (await source.getSearchMangaList({query:'',page:2,filters:[]},ctx)).entries.map(e=>e.key));
  console.log('filter nsfw', (await source.getSearchMangaList({query:'',page:1,filters:[{type:'multiSelect',id:'rating',included:['nsfw'],excluded:[]}]},ctx)).entries.map(e=>e.key+e.contentRating));
  console.log('list', (await source.getMangaList({id:'new-titles'},3,ctx)).hasNextPage);
  console.log(JSON.stringify(await source.getMangaUpdate({key:'x',title:'x'},true,true,ctx)));
  console.log(JSON.stringify(await source.getPageList({}, {key:'c1'}, ctx)));
  console.log('cookie sent:', calls[0].cookie);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
