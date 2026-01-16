
import React, { useState, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { format } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// --- Types ---
type StorageType = '냉장고' | '냉동실' | '실온' | '조미료';
type TabType = 'fridge' | 'recipes' | 'shopping';
type RecipeStatus = 'always' | 'want' | 'none';
type RecipeFilter = 'ready' | 'almost' | 'always' | 'want' | 'all' | 'ai_find' | null;

interface Ingredient {
  id: string; name: string; emoji: string; quantity: string;
  category: StorageType; purchaseDate: string; expiryDate?: string; label?: string;
}
interface Recipe { 
  id: string; title: string; ingredients: string[]; 
  url?: string; status: RecipeStatus; emoji: string;
}
interface ShoppingItem { 
  id: string; name: string; store: string; price: number; completed: boolean; 
}

// --- Constants & Utils ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const EMOJI_MAP: Record<string, string> = {
  '계란': '🥚', '우유': '🥛', '고기': '🥩', '무': '🥙', '당근': '🥕', '양파': '🧅', 
  '버섯': '🍄', '파': '🌿', '마늘': '🧄', '두부': '⬜', '숙주': '🌱', '김치': '🌶️', '물': '💧', '사과': '🍎', '빵': '🍞', '치즈': '🧀', '햄': '🥓', '생선': '🐟'
};
const FOOD_EMOJIS = ['🥘', '🍛', '🥗', '🍝', '🍜', '🍲', '🍱', '🍖', '🍗', '🥪', '🍕', '🍔'];
const getAutoEmoji = (n: string) => EMOJI_MAP[Object.keys(EMOJI_MAP).find(k => n.includes(k)) || ''] || '📦';
const getRandomRecipeEmoji = (ings: string[]) => {
  const found = ings.map(i => EMOJI_MAP[Object.keys(EMOJI_MAP).find(k => i.includes(k)) || '']).filter(Boolean);
  if (found.length > 0) return found[Math.floor(Math.random() * found.length)]!;
  return FOOD_EMOJIS[Math.floor(Math.random() * FOOD_EMOJIS.length)]!;
};
const parsePrice = (val: string) => parseInt(String(val).replace(/[^0-9]/g, '')) || 0;

const App = () => {
  // Persistence
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => JSON.parse(localStorage.getItem('fb_v6_ing') || '[]'));
  const [recipes, setRecipes] = useState<Recipe[]>(() => JSON.parse(localStorage.getItem('fb_v6_rec') || '[]'));
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>(() => JSON.parse(localStorage.getItem('fb_v6_shop') || '[]'));
  const [marts, setMarts] = useState<string[]>(() => JSON.parse(localStorage.getItem('fb_v6_marts') || '[]'));

  // UI State
  const [tab, setTab] = useState<TabType>('fridge');
  const [recFilter, setRecFilter] = useState<RecipeFilter>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiDiscoveredRecipe, setAiDiscoveredRecipe] = useState<Recipe | null>(null);
  const [prefillShopName, setPrefillShopName] = useState('');
  const [highlightedIngId, setHighlightedIngId] = useState<string | null>(null);
  
  // AI Search UI State
  const [aiIngFilterCat, setAiIngFilterCat] = useState<StorageType | null>(null);
  const [selectedIngsForAi, setSelectedIngsForAi] = useState<string[]>([]);
  
  // Accordion State (Expanded by default on desktop)
  const [expandedCats, setExpandedCats] = useState<string[]>(['냉장고', '냉동실', '실온', '조미료']);
  const toggleCat = (cat: string) => setExpandedCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);

  useEffect(() => {
    localStorage.setItem('fb_v6_ing', JSON.stringify(ingredients));
    localStorage.setItem('fb_v6_rec', JSON.stringify(recipes));
    localStorage.setItem('fb_v6_shop', JSON.stringify(shoppingItems));
    localStorage.setItem('fb_v6_marts', JSON.stringify(marts));
  }, [ingredients, recipes, shoppingItems, marts]);

  // --- Helpers ---
  const handleOwnedIngClick = (ingName: string) => {
    const ing = ingredients.find(i => i.name.includes(ingName));
    if (ing) {
      setTab('fridge');
      if (!expandedCats.includes(ing.category)) setExpandedCats(prev => [...prev, ing.category]);
      setHighlightedIngId(ing.id);
      setTimeout(() => setHighlightedIngId(null), 3000);
    }
  };

  const handleMissingIngClick = (ingName: string) => {
    setTab('shopping');
    setPrefillShopName(ingName);
    setIsAdding(true);
    setEditingId(null);
  };

  // --- AI Logic ---
  const handleAiExpiry = async (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const n = fd.get('n') as string;
    const c = fd.get('c') as string;
    const p = fd.get('p') as string; 
    if (!n || !p) return alert('재료명과 구매일을 먼저 입력해주세요!');
    setLoading(true);
    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `식품명: ${n}, 보관방법: ${c}, 구매일: ${p}. 예상 유통기한 종료일을 YYYY-MM-DD 형식으로 하나만 답하세요. 만약 식품명이 무의미한 문자열이거나 알 수 없는 단어라면 반드시 'INVALID'라고만 답변하세요.`
      });
      const text = res.text?.trim() || '';
      if (text.includes('INVALID')) {
        alert('정확하지 않은 식품명입니다. 다시 입력해 주세요.');
      } else {
        const date = text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
        const input = form.querySelector('input[name="e"]') as HTMLInputElement;
        if (input) input.value = date;
      }
    } catch { alert('AI 추천 실패'); }
    setLoading(false);
  };

  const discoverRecipeWithSelection = async () => {
    if (selectedIngsForAi.length === 0) return alert('재료를 최소 하나 이상 선택해주세요!');
    setLoading(true);
    try {
      const ingNames = selectedIngsForAi.join(', ');
      const res = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `${ingNames}을 주재료로 초간단 요리 하나를 추천하세요. 재료명에 수량(2알, 50ml 등)을 절대 포함하지 말고 순수 재료 이름만 적으세요. 형식은 JSON: {"title": "요리명", "ingredients": ["계란", "양파", "간장"]}`
      });
      const data = JSON.parse((res.text || '').replace(/```json|```/g, '').trim());
      const newRecipe: Recipe = { 
        ...data, 
        id: 'temp-' + Date.now(), 
        status: 'none', 
        emoji: getRandomRecipeEmoji(data.ingredients) 
      };
      setAiDiscoveredRecipe(newRecipe);
    } catch { alert('레시피 추천 실패'); }
    setLoading(false);
  };

  // --- Core Logic ---
  const filteredRecipes = useMemo(() => {
    const myIngs = ingredients.map(i => i.name);
    return recipes.map(r => {
      const missing = r.ingredients.filter(ri => !myIngs.some(mn => mn.includes(ri)));
      return { ...r, missing };
    }).filter(r => {
      if (!recFilter) return false;
      if (recFilter === 'ready') return r.missing.length === 0 && r.status === 'none';
      if (recFilter === 'almost') return r.missing.length > 0 && r.missing.length <= 2 && r.status === 'none';
      if (recFilter === 'all') return true;
      if (recFilter === 'always') return r.status === 'always';
      if (recFilter === 'want') return r.status === 'want';
      return true;
    }).sort((a, b) => a.missing.length - b.missing.length);
  }, [recipes, ingredients, recFilter]);

  const groupedShopping = useMemo(() => {
    return shoppingItems.reduce((acc, item) => {
      const s = item.store || '미지정';
      if (!acc[s]) acc[s] = { items: [], total: 0 };
      acc[s].items.push(item);
      acc[s].total += item.price;
      return acc;
    }, {} as Record<string, { items: ShoppingItem[], total: number }>);
  }, [shoppingItems]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (tab === 'fridge') {
      const newItem: Ingredient = { 
        id: editingId || Date.now().toString(), name: fd.get('n') as string, emoji: fd.get('emoji') as string, quantity: fd.get('q') as string, 
        category: fd.get('c') as StorageType, purchaseDate: fd.get('p') as string, 
        expiryDate: fd.get('e') as string || undefined, label: fd.get('l') as string 
      };
      setIngredients(prev => editingId ? prev.map(i => i.id === editingId ? newItem : i) : [newItem, ...prev]);
    } else if (tab === 'recipes') {
      const title = (fd.get('t') as string).trim();
      const rawIngs = (fd.get('i') as string).split(',').map(s => s.trim()).filter(s => s !== "");
      const ings = Array.from(new Set(rawIngs));
      
      const isDuplicate = recipes.some(r => {
        if (editingId && r.id === editingId) return false;
        const sameTitle = r.title.trim() === title;
        const sameIngs = r.ingredients.length === ings.length && 
                         [...r.ingredients].sort().join(',') === [...ings].sort().join(',');
        return sameTitle && sameIngs;
      });

      if (isDuplicate) {
        alert('이미 동일한 이름과 재료 구성을 가진 레시피가 존재합니다!');
        return;
      }

      const inputEmoji = fd.get('re') as string;
      const finalEmoji = (inputEmoji === '🥘' || !inputEmoji || inputEmoji.trim() === '') ? getRandomRecipeEmoji(ings) : inputEmoji;

      const newItem: Recipe = { 
        id: editingId || Date.now().toString(), 
        title, 
        ingredients: ings, 
        url: fd.get('u') as string, 
        status: fd.get('status') as RecipeStatus,
        emoji: finalEmoji
      };
      setRecipes(prev => editingId ? prev.map(r => r.id === editingId ? newItem : r) : [newItem, ...prev]);
    } else {
      const store = (fd.get('s') as string) || '미지정';
      if (store !== '미지정' && !marts.includes(store)) setMarts([...marts, store]);
      const newItem: ShoppingItem = { 
        id: editingId || Date.now().toString(), name: fd.get('n') as string, store, 
        price: parsePrice(fd.get('pr') as string), completed: false 
      };
      setShoppingItems(prev => editingId ? prev.map(i => i.id === editingId ? newItem : i) : [newItem, ...prev]);
    }
    setIsAdding(false);
    setEditingId(null);
    setPrefillShopName('');
  };

  const editingItem = useMemo(() => {
    if (!editingId) return null;
    if (tab === 'fridge') return ingredients.find(i => i.id === editingId);
    if (tab === 'recipes') return recipes.find(r => r.id === editingId);
    if (tab === 'shopping') return shoppingItems.find(i => i.id === editingId);
    return null;
  }, [editingId, tab, ingredients, recipes, shoppingItems]);

  const EmptyState = ({ emoji, text, compact = false }: { emoji: string; text: string; compact?: boolean }) => (
    <div className={`${compact ? 'py-4' : 'py-20'} text-center space-y-2 animate-fade-up w-full`}>
      <p className="text-3xl grayscale-0 italic-none select-none">{emoji}</p>
      <p className="text-[12px] text-[#A9AF8E] text-center uppercase tracking-widest font-normal italic">
        {text}
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FEFAE0] flex flex-col select-none text-[#606C38]">
      
      {/* HEADER */}
      <header className="bg-[#FAEDCE] sticky top-0 z-40 border-b border-[#E0E5B6] shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6 md:py-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl md:text-4xl italic tracking-tighter uppercase font-black cursor-pointer" onClick={() => window.location.reload()}>냉장고파먹기</h1>
            <button onClick={() => { setIsAdding(true); setEditingId(null); setPrefillShopName(''); }} className="md:hidden w-12 h-12 bg-[#CCD5AE] text-white rounded-[22px] text-2xl shadow-xl active:scale-90 flex items-center justify-center">＋</button>
          </div>
          
          <div className="flex flex-col md:flex-row items-center gap-4 flex-1 md:justify-end">
            <div className="flex bg-[#E0E5B6] p-1 rounded-[24px] w-full md:w-auto md:min-w-[400px]">
              {(['fridge', 'recipes', 'shopping'] as TabType[]).map(t => (
                <button key={t} onClick={() => { setTab(t); if(t!=='recipes') setRecFilter(null); setEditingId(null); }} className={`flex-1 py-3 px-4 text-[12px] md:text-[14px] rounded-[20px] transition-all whitespace-nowrap ${tab === t ? 'bg-[#FAEDCE] shadow-sm text-[#606C38] font-bold' : 'text-[#A9AF8E] hover:text-[#606C38]'}`}>
                  {t === 'fridge' ? '나의 냉장고' : t === 'recipes' ? '요리 리서치' : '장보기 목록'}
                </button>
              ))}
            </div>
            <button onClick={() => { setIsAdding(true); setEditingId(null); setPrefillShopName(''); }} className="hidden md:flex w-14 h-14 bg-[#CCD5AE] text-white rounded-[24px] text-3xl shadow-xl hover:shadow-2xl hover:bg-[#B9C49A] transition-all active:scale-90 items-center justify-center">＋</button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 md:p-10 overflow-y-auto pb-32 no-scrollbar">
        
        {/* FRIDGE TAB */}
        {tab === 'fridge' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8 animate-fade-up">
            {(['냉장고', '냉동실', '실온', '조미료'] as StorageType[]).map(cat => {
              const catIngs = ingredients.filter(i => i.category === cat);
              return (
                <section key={cat} className="bg-white/40 rounded-[32px] p-6 border border-[#E0E5B6] shadow-sm h-full flex flex-col">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-[14px] md:text-[16px] uppercase tracking-widest font-black text-[#606C38]">
                      {cat} <span className="text-[#CCD5AE] ml-1">{catIngs.length}</span>
                    </h3>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {catIngs.length === 0 ? (
                      <div className="col-span-full py-8">
                        <EmptyState emoji="🗑️" text="비어있습니다." compact />
                      </div>
                    ) : (
                      catIngs.map(ing => {
                        const todayStr = format(new Date(), 'yyyy-MM-dd');
                        const isExp = ing.expiryDate && ing.expiryDate < todayStr;
                        const isHighlighted = highlightedIngId === ing.id;
                        return (
                          <div 
                            key={ing.id} 
                            onClick={() => { setEditingId(ing.id); setIsAdding(true); }} 
                            className={`flex flex-col p-4 rounded-[24px] border border-[#E0E5B6] shadow-sm hover:shadow-md active:scale-[0.98] transition-all cursor-pointer group min-h-[100px] ${isHighlighted ? 'bg-[#FAEDCE] border-[#CCD5AE]' : 'bg-white/80'}`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-2xl italic-none">{ing.emoji}</span>
                              <div className="text-right">
                                {ing.label && <span className="text-[10px] bg-[#CCD5AE]/30 text-[#606C38] px-2 py-0.5 rounded-full font-bold">{ing.label}</span>}
                              </div>
                            </div>
                            <h4 className="text-[15px] font-bold text-[#606C38] truncate mb-2">{ing.name}</h4>
                            <div className="mt-auto flex items-center justify-between">
                              <span className="text-[12px] text-[#606C38] font-medium">{ing.quantity || ''}</span>
                              <span className={`text-[11px] font-bold ${isExp ? 'text-red-500' : 'text-[#A9AF8E]'}`}>
                                {ing.expiryDate ? `${isExp ? '🚨' : '⌛'} ${ing.expiryDate}` : ''}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* RECIPES TAB */}
        {tab === 'recipes' && (
          <div className="max-w-5xl mx-auto space-y-10 animate-fade-up">
            <div className="flex flex-col items-center gap-6">
              <div className="flex flex-wrap justify-center bg-[#FAEDCE] p-2 rounded-[32px] border border-[#E0E5B6] shadow-md gap-2 w-fit">
                {[
                  {id:'ready', e:'📥', t:'Ready'}, {id:'almost', e:'📦', t:'Almost'}, {id:'always', e:'🌟', t:'Always'}, 
                  {id:'want', e:'💡', t:'Want'}, {id:'all', e:'🗂️', t:'All'}, {id:'ai_find', e:'🔍', t:'AI Search'}
                ].map(f => (
                  <button 
                    key={f.id} 
                    onClick={() => setRecFilter(f.id as any)} 
                    className={`px-6 py-3 flex items-center gap-3 rounded-[24px] text-[13px] font-bold transition-all ${recFilter === f.id ? 'bg-[#CCD5AE] text-white shadow-lg scale-105' : 'bg-white/50 text-[#A9AF8E] hover:text-[#606C38]'}`}
                  >
                    <span className="text-xl italic-none">{f.e}</span>
                    <span className="hidden md:inline uppercase tracking-widest">{f.t}</span>
                  </button>
                ))}
              </div>
            </div>
            
            {!recFilter && (
              <EmptyState emoji="🍽️" text="원하는 카테고리를 선택하여 레시피를 탐색해보세요." />
            )}

            {recFilter === 'ai_find' ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-up items-start">
                <div className="lg:col-span-1 bg-[#FAEDCE]/60 p-8 rounded-[40px] space-y-6 border border-[#E0E5B6] shadow-sm">
                  <div>
                    <h3 className="text-[14px] text-[#606C38] font-black uppercase tracking-widest mb-4">1단계: 장소 선택</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {(['냉장고', '냉동실', '실온', '조미료'] as StorageType[]).map(c => (
                        <button key={c} onClick={() => setAiIngFilterCat(c)} className={`py-3 rounded-[18px] text-[12px] transition-all font-bold ${aiIngFilterCat === c ? 'bg-[#CCD5AE] text-white' : 'bg-white text-[#A9AF8E] border border-[#E0E5B6]'}`}>{c}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[14px] text-[#606C38] font-black uppercase tracking-widest mb-4">2단계: 재료 고르기</h3>
                    <div className="flex flex-wrap gap-2 min-h-[120px] bg-white/40 p-3 rounded-2xl border border-[#E0E5B6]/50">
                      {!aiIngFilterCat ? (
                        <p className="text-[11px] text-[#A9AF8E] w-full text-center py-10 italic">장소를 먼저 선택해주세요.</p>
                      ) : (
                        ingredients.filter(i => i.category === aiIngFilterCat).map(ing => {
                          const isSel = selectedIngsForAi.includes(ing.name);
                          return (
                            <button key={ing.id} onClick={() => setSelectedIngsForAi(prev => isSel ? prev.filter(x => x !== ing.name) : [...prev, ing.name])} className={`px-4 py-2.5 rounded-[18px] flex items-center gap-2 border transition-all active:scale-95 ${isSel ? 'bg-[#CCD5AE] border-[#CCD5AE] text-white shadow-md' : 'bg-white border-[#E0E5B6] text-[#606C38] shadow-sm hover:border-[#CCD5AE]'}`}>
                              <span className="italic-none">{ing.emoji}</span> <span className="text-[13px] font-bold">{ing.name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <button onClick={discoverRecipeWithSelection} disabled={loading || selectedIngsForAi.length === 0} className={`w-full py-5 rounded-[24px] text-[15px] font-black shadow-xl transition-all active:scale-95 ${selectedIngsForAi.length > 0 ? 'bg-[#606C38] text-white hover:bg-[#4E582E]' : 'bg-[#E0E5B6] text-[#A9AF8E] cursor-not-allowed'}`}>
                    {loading ? 'AI 레시피 생성 중...' : `선택한 ${selectedIngsForAi.length}개로 추천받기`}
                  </button>
                </div>

                <div className="lg:col-span-2 space-y-4">
                  {!aiDiscoveredRecipe && !loading && <EmptyState emoji="✨" text="재료를 선택하고 AI 추천 버튼을 눌러보세요." />}
                  {loading && <div className="py-20 flex flex-col items-center animate-pulse"><span className="text-4xl mb-4">🍳</span><p className="text-[#A9AF8E] italic">냉장고 속 재료로 최고의 메뉴를 구상 중입니다...</p></div>}
                  {aiDiscoveredRecipe && (
                    <div className="bg-white p-10 rounded-[48px] border-2 border-[#CCD5AE] shadow-xl relative animate-fade-up flex flex-col md:flex-row gap-8">
                      <div className="md:w-1/3 flex flex-col items-center justify-center bg-[#FAEDCE]/40 rounded-[32px] p-6">
                        <span className="text-7xl mb-6 italic-none">{aiDiscoveredRecipe.emoji}</span>
                        <h4 className="text-[22px] font-black text-[#606C38] text-center leading-tight">{aiDiscoveredRecipe.title}</h4>
                      </div>
                      <div className="md:w-2/3 flex flex-col">
                        <p className="text-[12px] font-black uppercase tracking-widest text-[#A9AF8E] mb-4">필요한 재료</p>
                        <div className="flex flex-wrap gap-2 mb-8">
                          {aiDiscoveredRecipe.ingredients.map(ri => { 
                            const has = ingredients.some(i => i.name.includes(ri)); 
                            return <span key={ri} className={`text-[13px] px-4 py-2 rounded-full font-bold shadow-sm ${has ? 'bg-[#CCD5AE]/30 text-[#606C38]' : 'bg-red-50 text-red-400 border border-red-100'}`}>{has ? '✅' : '🛒'} {ri}</span>;
                          })}
                        </div>
                        <div className="mt-auto grid grid-cols-3 gap-3">
                            <button onClick={() => {setRecipes([{...aiDiscoveredRecipe, id: Date.now().toString(), status: 'always'}, ...recipes]); setAiDiscoveredRecipe(null);}} className="flex flex-col items-center justify-center p-4 rounded-[20px] bg-[#FAEDCE] text-yellow-600 border border-[#E0E5B6] hover:bg-white transition-all shadow-sm group"><span className="text-2xl group-hover:scale-125 transition-transform italic-none">🌟</span><span className="text-[10px] mt-1 font-bold">자주 요리</span></button>
                            <button onClick={() => {setRecipes([{...aiDiscoveredRecipe, id: Date.now().toString(), status: 'want'}, ...recipes]); setAiDiscoveredRecipe(null);}} className="flex flex-col items-center justify-center p-4 rounded-[20px] bg-[#FAEDCE] text-blue-500 border border-[#E0E5B6] hover:bg-white transition-all shadow-sm group"><span className="text-2xl group-hover:scale-125 transition-transform italic-none">💡</span><span className="text-[10px] mt-1 font-bold">하고 싶은 요리</span></button>
                            <button onClick={() => {setRecipes([{...aiDiscoveredRecipe, id: Date.now().toString(), status: 'none'}, ...recipes]); setAiDiscoveredRecipe(null);}} className="flex flex-col items-center justify-center p-4 rounded-[20px] bg-[#FAEDCE] text-[#A9AF8E] border border-[#E0E5B6] hover:bg-white transition-all shadow-sm group"><span className="text-2xl group-hover:scale-125 transition-transform italic-none">🗂️</span><span className="text-[10px] mt-1 font-bold">보관함에 저장</span></button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              recFilter && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredRecipes.length === 0 ? (
                    <div className="col-span-full"><EmptyState emoji="🍽️" text="해당 레시피가 없습니다." /></div>
                  ) : (
                    filteredRecipes.map(r => (
                      <div key={r.id} onClick={() => {setEditingId(r.id); setIsAdding(true);}} className="bg-white/60 p-8 rounded-[40px] border border-[#E0E5B6] shadow-sm hover:shadow-lg transition-all cursor-pointer group flex flex-col h-full animate-fade-up">
                        <div className="flex justify-between items-start mb-6 gap-4">
                          <div className="flex-1 flex items-center gap-4 overflow-hidden">
                            <span className="text-4xl flex-shrink-0 italic-none group-hover:rotate-12 transition-transform">{r.emoji}</span>
                            <div className="overflow-hidden">
                              <h4 className="text-[18px] font-black text-[#606C38] truncate group-hover:text-[#CCD5AE] transition-colors">{r.title}</h4>
                              <button onClick={(e) => { e.stopPropagation(); if(r.url) window.open(r.url); else window.open(`https://www.google.com/search?q=${encodeURIComponent(r.title + ' 레시피')}`); }} className="text-[11px] text-[#A9AF8E] hover:underline">레시피 상세보기 →</button>
                            </div>
                          </div>
                          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setRecipes(recipes.map(rc => rc.id === r.id ? {...rc, status: rc.status === 'always' ? 'none' : 'always'} : rc))} className={`w-10 h-10 flex items-center justify-center rounded-full transition-all border ${r.status === 'always' ? 'bg-[#CCD5AE] text-white border-[#CCD5AE] shadow-md' : 'bg-white/50 border-[#E0E5B6] text-[#A9AF8E] hover:border-[#CCD5AE]'}`}>🌟</button>
                            <button onClick={() => setRecipes(recipes.map(rc => rc.id === r.id ? {...rc, status: rc.status === 'want' ? 'none' : 'want'} : rc))} className={`w-10 h-10 flex items-center justify-center rounded-full transition-all border ${r.status === 'want' ? 'bg-[#606C38] text-white border-[#606C38] shadow-md' : 'bg-white/50 border-[#E0E5B6] text-[#A9AF8E] hover:border-[#CCD5AE]'}`}>💡</button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t border-[#E0E5B6]/50">
                          {r.ingredients.map(ri => { 
                            const has = ingredients.some(i => i.name.includes(ri)); 
                            return (
                              <button key={ri} onClick={(e) => { e.stopPropagation(); has ? handleOwnedIngClick(ri) : handleMissingIngClick(ri); }} className={`text-[12px] px-3 py-1.5 rounded-[12px] transition-all font-bold ${has ? 'bg-[#CCD5AE]/20 text-[#606C38] hover:bg-[#CCD5AE]/40' : 'bg-red-50 text-red-500 border border-red-100 hover:bg-red-100'}`}>
                                {has ? '✅' : '🛒'} {ri}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )
                </div>
              )
            )}
          </div>
        )}

        {/* SHOPPING TAB */}
        {tab === 'shopping' && (
          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-up">
            {Object.keys(groupedShopping).length === 0 && (
              <div className="col-span-full"><EmptyState emoji="🛒" text="장볼 것이 없네요! 냉장고가 꽉 찼나요?" /></div>
            )}
            {(Object.entries(groupedShopping) as any).map(([store, data]: any) => (
              <section key={store} className="bg-white/50 rounded-[32px] p-8 border border-[#E0E5B6] shadow-sm flex flex-col h-fit">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex flex-col">
                    <h3 className="text-[16px] font-black uppercase tracking-widest text-[#606C38] mb-1">{store}</h3>
                    <span className="text-[12px] text-[#A9AF8E] font-bold">{data.items.length}개의 품목</span>
                  </div>
                  <span className="text-[16px] px-4 py-2 rounded-[16px] bg-[#CCD5AE] text-white font-black shadow-sm">
                    {data.total.toLocaleString()}원
                  </span>
                </div>
                <div className="space-y-3">
                  {data.items.map((item: any) => (
                    <div key={item.id} onClick={() => {setEditingId(item.id); setIsAdding(true);}} className="flex items-center gap-4 bg-white px-5 py-4 rounded-[24px] border border-[#E0E5B6] shadow-sm hover:shadow-md hover:border-[#CCD5AE] transition-all cursor-pointer group">
                      <button onClick={(e) => { e.stopPropagation(); setShoppingItems(shoppingItems.map(si => si.id === item.id ? {...si, completed: !si.completed} : si)); }} className={`w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center flex-shrink-0 ${item.completed ? 'bg-[#CCD5AE] border-[#CCD5AE] text-white' : 'border-[#E0E5B6]'}`}>
                        {item.completed && '✓'}
                      </button>
                      <div className="flex-1 flex justify-between items-center overflow-hidden">
                        <span className={`text-[15px] truncate font-bold ${item.completed ? 'line-through text-[#A9AF8E]' : 'text-[#606C38]'}`}>{item.name}</span>
                        <span className="text-[13px] text-[#A9AF8E] flex-shrink-0 ml-2 font-black">{item.price > 0 ? `${item.price.toLocaleString()}원` : ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {/* MODAL */}
      {isAdding && (
        <div className="fixed inset-0 bg-[#606C38]/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSubmit} className="bg-[#FEFAE0] w-full max-w-lg rounded-[48px] p-8 md:p-12 shadow-2xl animate-in fade-in zoom-in duration-300 max-h-[90vh] overflow-y-auto no-scrollbar border border-[#CCD5AE]/30 relative">
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-[20px] font-black text-[#606C38] tracking-tight">{editingId ? '정보 수정하기' : '새로운 기록'}</h2>
              <button type="button" onClick={() => { setIsAdding(false); setEditingId(null); setPrefillShopName(''); }} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/50 text-[#A9AF8E] text-2xl hover:text-red-400 transition-colors">✕</button>
            </div>
            
            <div className="space-y-6">
              {tab === 'fridge' ? (
                <>
                  <div className="grid grid-cols-4 gap-4">
                    <input name="emoji" maxLength={2} defaultValue={(editingItem as Ingredient)?.emoji || '📦'} className="col-span-1 h-[64px] bg-white p-3 rounded-[24px] text-center text-3xl border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm italic-none" />
                    <input name="n" required defaultValue={(editingItem as Ingredient)?.name} placeholder="재료 이름" onChange={(ev) => { if(!editingId) (ev.target.form!.querySelector('input[name="emoji"]') as HTMLInputElement).value = getAutoEmoji(ev.target.value); }} className="col-span-3 h-[64px] bg-white px-6 rounded-[24px] text-[16px] border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm text-[#606C38] font-bold" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <input name="q" defaultValue={(editingItem as Ingredient)?.quantity} placeholder="수량 (예: 2알, 1kg)" className="h-[60px] bg-white px-6 rounded-[24px] text-[14px] border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm text-[#606C38] font-bold" />
                    <select name="c" defaultValue={(editingItem as Ingredient)?.category || '냉장고'} className="h-[60px] bg-white px-6 rounded-[24px] text-[14px] border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm text-[#606C38] font-bold appearance-none">
                      <option>냉장고</option><option>냉동실</option><option>실온</option><option>조미료</option>
                    </select>
                  </div>
                  <div className="bg-[#E0E5B6]/20 p-6 rounded-[32px] space-y-6 border border-[#E0E5B6]/30">
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-black text-[#A9AF8E] uppercase tracking-widest ml-2">재료 라벨</label>
                      <input name="l" placeholder="메모 혹은 라벨" defaultValue={(editingItem as Ingredient)?.label} className="w-full h-[54px] bg-white px-5 rounded-[20px] text-[13px] font-bold text-[#606C38] border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm italic-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-black text-[#A9AF8E] uppercase tracking-widest ml-2">구매일</label>
                        <input name="p" type="date" defaultValue={(editingItem as Ingredient)?.purchaseDate || format(new Date(), 'yyyy-MM-dd')} className="w-full h-[54px] bg-white px-4 rounded-[18px] text-[13px] border-none shadow-sm outline-none text-[#606C38] font-bold" />
                      </div>
                      <div className="flex flex-col gap-2 relative">
                        <div className="flex justify-between items-center pr-2">
                          <label className="text-[11px] font-black text-[#A9AF8E] uppercase tracking-widest ml-2">유통기한</label>
                          <button type="button" onClick={(e) => handleAiExpiry(e.currentTarget.form!)} disabled={loading} className="text-[10px] font-black text-[#CCD5AE] hover:text-[#606C38] transition-colors">✨ AI 추천</button>
                        </div>
                        <input name="e" type="date" defaultValue={(editingItem as Ingredient)?.expiryDate} className="w-full h-[54px] bg-white px-4 rounded-[18px] text-[13px] border-none shadow-sm outline-none text-[#606C38] font-bold" />
                      </div>
                    </div>
                  </div>
                </>
              ) : tab === 'recipes' ? (
                <>
                  <div className="grid grid-cols-4 gap-4">
                    <input name="re" maxLength={2} defaultValue={(editingItem as Recipe)?.emoji || '🥘'} className="col-span-1 h-[64px] bg-white p-3 rounded-[24px] text-center text-3xl border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm italic-none" />
                    <input name="t" required defaultValue={(editingItem as Recipe)?.title} placeholder="요리 이름" className="col-span-3 h-[64px] bg-white px-6 rounded-[24px] text-[16px] border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm text-[#606C38] font-black" />
                  </div>
                  <textarea name="i" required defaultValue={(editingItem as Recipe)?.ingredients.join(', ')} placeholder="필요한 재료를 쉼표로 적어주세요 (예: 고추장, 삼겹살, 대파)" className="w-full bg-white p-6 rounded-[24px] text-[14px] min-h-[120px] border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm text-[#606C38] font-bold leading-relaxed" />
                  <input name="u" defaultValue={(editingItem as Recipe)?.url} placeholder="레시피 참고 URL (선택)" className="w-full h-[60px] bg-white px-6 rounded-[24px] text-[14px] border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm font-bold text-[#606C38]" />
                  <div className="flex gap-4">
                    {[{v:'always',e:'🌟',t:'Always'},{v:'want',e:'💡',t:'Want'},{v:'none',e:'🗂️',t:'Library'}].map(st => (
                      <label key={st.v} className="flex-1 cursor-pointer">
                        <input type="radio" name="status" value={st.v} defaultChecked={(editingItem as Recipe)?.status === st.v || (!editingId && st.v==='none')} className="hidden peer" />
                        <div className="p-4 rounded-[24px] bg-white text-2xl flex flex-col items-center justify-center transition-all shadow-sm border-2 border-transparent peer-checked:bg-[#CCD5AE] peer-checked:border-[#CCD5AE] peer-checked:scale-105 peer-checked:text-white italic-none">
                          <span>{st.e}</span>
                          <span className="text-[10px] mt-1 font-black uppercase tracking-widest">{st.t}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <input name="n" required defaultValue={prefillShopName || (editingItem as ShoppingItem)?.name} placeholder="무엇을 살까요?" className="w-full h-[70px] bg-white px-8 rounded-[24px] text-[18px] border-2 border-transparent focus:border-[#CCD5AE] outline-none shadow-sm font-black text-[#606C38]" />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative">
                      <input name="s" defaultValue={(editingItem as ShoppingItem)?.store} placeholder="어디 마트?" list="marts-list" className="w-full h-[64px] bg-white px-6 rounded-[24px] text-[14px] border-2 border-transparent focus:border-[#CCD5AE] outline-none font-bold shadow-sm text-[#606C38]" />
                      <datalist id="marts-list">{marts.map(m => <option key={m} value={m} />)}</datalist>
                    </div>
                    <input name="pr" defaultValue={(editingItem as ShoppingItem)?.price || ''} placeholder="예상 가격(원)" className="h-[64px] bg-white px-6 rounded-[24px] text-[14px] border-2 border-transparent focus:border-[#CCD5AE] outline-none font-black text-right shadow-sm text-[#606C38]" />
                  </div>
                </>
              )}
              
              <div className="flex gap-4 pt-10">
                {editingId && <button type="button" onClick={() => { if(tab==='fridge') setIngredients(prev => prev.filter(i=>i.id!==editingId)); else if(tab==='recipes') setRecipes(prev => prev.filter(r=>r.id!==editingId)); else setShoppingItems(prev => prev.filter(i=>i.id!==editingId)); setIsAdding(false); setEditingId(null); }} className="flex-1 bg-red-50 text-red-500 py-5 rounded-[24px] text-[14px] font-black active:scale-95 transition-all border border-red-100 shadow-sm hover:bg-red-500 hover:text-white">삭제하기</button>}
                <button disabled={loading} className="flex-[2] bg-[#606C38] text-white py-5 rounded-[24px] text-[15px] font-black shadow-2xl active:scale-95 transition-all disabled:bg-[#E0E5B6] hover:bg-[#4E582E]">{editingId ? '수정 사항 저장' : '목록에 추가하기'}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* FOOTER */}
      <footer className="py-10 text-center border-t border-[#E0E5B6]/50 bg-white/30">
        <p className="text-[12px] text-[#A9AF8E] font-bold tracking-widest uppercase">Smart Kitchen Manager © 2025</p>
      </footer>

      <style>{`
        /* 모든 요소에 Pretendard 폰트 강제 적용 */
        * {
          font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif !important;
        }

        .no-scrollbar::-webkit-scrollbar { display: none; }
        @keyframes fade-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-up { animation: fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        
        /* 이모지 등 이탤릭이 불필요한 요소용 */
        .italic-none { font-style: normal !important; }
        
        body { 
          background-color: #FEFAE0; 
          margin: 0;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
      `}</style>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
