import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabase';

// --- 유틸리티 및 데이터 ---
const getTodayStr = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
};

const CATEGORIES = {
  '에어컨': ['벽걸이', '스탠드', '2in1', '시스템'],
  '세탁기': ['통돌이', '드럼', '아기용'],
  '에어컨 설치': ['스탠드 설치', '벽걸이 설치', '냉매 보충']
};

const DEFAULT_PRICES = {
  '벽걸이': 80000,
  '스탠드': 120000,
  '2in1': 200000,
  '시스템': 130000,
  '통돌이': 100000,
  '드럼': 160000,
  '아기용': 70000
};

// 숫자 콤마 포맷
const fmtNum = (num) => Number(num).toLocaleString('ko-KR');

// 롱 프레스 훅 (수정/삭제용)
function useLongPress(callback, ms = 500) {
  const [startLongPress, setStartLongPress] = useState(false);
  const timerRef = useRef();

  useEffect(() => {
    if (startLongPress) {
      timerRef.current = setTimeout(() => {
        callback();
        setStartLongPress(false);
      }, ms);
    } else {
      clearTimeout(timerRef.current);
    }
    return () => clearTimeout(timerRef.current);
  }, [callback, ms, startLongPress]);

  return {
    onMouseDown: () => setStartLongPress(true),
    onMouseUp: () => setStartLongPress(false),
    onMouseLeave: () => setStartLongPress(false),
    onTouchStart: () => setStartLongPress(true),
    onTouchEnd: () => setStartLongPress(false),
  };
}


function App() {
  const [session, setSession] = useState(null);

  // 로그인/가입 폼 상태
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(''); // 플랫폼 확장을 위한 파트너 초대코드
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // 계정 및 업체 정보
  const [businessProfile, setBusinessProfile] = useState({ company_name: '클린브로', phone: '', logo_url: '' });

  const [currentTab, setCurrentTab] = useState('calendar'); // calendar, add, list, stats, settings
  const [customers, setCustomers] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [mapPopupMemo, setMapPopupMemo] = useState(null);

  // 추가 기능: 프로필 닉네임, 팀원 리스트, 지출 리스트
  const [myNickname, setMyNickname] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);

  // ==========================================
  // [인증 관련 (Supabase Auth)]
  // ==========================================
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // 자동 로그인 해제 시 브라우저 종료할 때 로그아웃 처리
    const handleUnload = () => {
      if (sessionStorage.getItem('no_remember') === 'true') {
        supabase.auth.signOut();
      }
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    let error;
    if (isLoginMode) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      error = signInError;
      if (!error) {
        if (!rememberMe) sessionStorage.setItem('no_remember', 'true');
        else sessionStorage.removeItem('no_remember');
      }
    } else {
      const newBusinessId = inviteCode.trim() || window.crypto.randomUUID();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { business_id: newBusinessId }
        }
      });
      error = signUpError;
      if (!error) alert('가입 성공! 메일함을 확인하거나 바로 로그인 하세요.');
    }
    setAuthLoading(false);

    if (error) alert(error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null); // 즉시 세션 상태 초기화 및 화면 전환
  };

  // ==========================================
  // [데이터 로딩 및 실시간 동기화 (Supabase DB)]
  // ==========================================
  const myBusinessId = session?.user?.user_metadata?.business_id || session?.user?.id;

  const fetchProfile = async () => {
    if (!myBusinessId) return;
    // 업체 정보
    const { data: bData } = await supabase.from('businesses').select('*').eq('id', myBusinessId).single();
    if (bData) setBusinessProfile(bData);

    // 내 닉네임 프로필 정보
    const { data: pData } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (pData?.nickname) setMyNickname(pData.nickname);
  };

  const fetchTeamMembers = async () => {
    if (!myBusinessId) return;
    const { data, error } = await supabase.from('profiles').select('*').eq('business_id', myBusinessId);
    if (!error && data) {
      setTeamMembers(data.map(p => p.nickname).filter(Boolean));
    }
  };

  const fetchExpenses = async () => {
    if (!myBusinessId) return;
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('business_id', myBusinessId)
      .order('id', { ascending: false });
    if (!error && data) setExpenses(data);
  };

  const fetchCustomers = async () => {
    setLoadingData(true);
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('business_id', myBusinessId)
      .order('id', { ascending: false });

    if (error) {
      console.error(error);
      // 기존 데이터의 business_id 누락 고려한 폴백
      const { data: fallbackData } = await supabase.from('bookings').select('*').eq('user_id', session.user.id).order('id', { ascending: false });
      if (fallbackData) setCustomers(fallbackData);
    } else {
      setCustomers(data || []);
    }
    setLoadingData(false);
  };

  useEffect(() => {
    if (session) {
      fetchProfile();
      fetchTeamMembers();
      fetchExpenses();
      fetchCustomers();

      // 실시간 데이터 동기화 구독 추가
      const bookingSubscription = supabase
        .channel('public:bookings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, payload => {
          console.log('Realtime change received!', payload);
          // 알림 띄우기 (간단한 브라우저 알림, 권한 필요)
          if (payload.event === 'INSERT' && payload.new.user_id !== session.user.id) {
            if (Notification.permission === "granted") {
              new Notification("새로운 예약이 등록되었습니다!", {
                body: `${payload.new.memo} 고객님의 예약이 추가되었습니다.`
              });
            } else {
              alert(`파트너가 새로운 예약을 추가했습니다: ${payload.new.memo}`);
            }
          }
          // 등록/수정/삭제 이벤트가 오면 다시 데이터를 불러옴
          fetchCustomers();
        })
        .subscribe();

      // 알림 권한 요청
      if (Notification.permission !== "denied") {
        Notification.requestPermission();
      }

      return () => {
        supabase.removeChannel(bookingSubscription);
      }
    } else {
      setCustomers([]);
    }
  }, [session]);


  // ==========================================
  // [공통 모달/수정/삭제 로직]
  // ==========================================
  const handleDelete = async (id) => {
    if (window.confirm('선택한 예약을 정말 삭제하시겠습니까?')) {
      const { error } = await supabase.from('bookings').delete().eq('id', id);
      if (error) alert('삭제 실패: ' + error.message);
      else fetchCustomers();
    }
  };

  const handleEdit = (customer) => {
    const c = customer;
    setCustomerName(c.customer_name || '');
    setNewPhone(c.phone || '');
    setAddress(c.address || '');
    setAddressDetail(c.address_detail || '');
    setHasCashReceipt(c.has_cash_receipt || false);
    setHasTaxInvoice(c.has_tax_invoice || false);
    setNewMemo(c.memo || '');
    setCategory(c.category || '에어컨');
    setProduct(c.product || '벽걸이');
    setQty(c.quantity || 1);
    setBasePrice(c.base_price || DEFAULT_PRICES['벽걸이']);
    setDiscountType(c.discount_type || 'none');
    setDiscountVal(c.discount_value || 0);
    setPayment(c.payment_method || '현금');
    setBookDate(c.book_date || getTodayStr());
    setBookTimeType(c.book_time_type || '09:00');
    setBookTimeCustom(c.book_time_custom || '');
    setAssignee(c.assignee || 'ccy6208');
    setIsCompleted(c.is_completed || false);
    setEditingId(c.id);
    setCurrentTab('add');
  };

  // ==========================================
  // [작업 완료 토글 (빠른 액션)]
  // ==========================================
  const toggleCompletion = async (c) => {
    const newValue = !c.is_completed;
    const { error } = await supabase
      .from('bookings')
      .update({ is_completed: newValue })
      .eq('id', c.id);

    if (error) alert('상태 변경 실패: ' + error.message);
    else fetchCustomers();
  };

  // ==========================================
  // [탭: 예약 등록 (Add)]
  // ==========================================
  const [editingId, setEditingId] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [address, setAddress] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [hasCashReceipt, setHasCashReceipt] = useState(false);
  const [hasTaxInvoice, setHasTaxInvoice] = useState(false);
  const [newMemo, setNewMemo] = useState('');
  const [category, setCategory] = useState('에어컨');
  const [product, setProduct] = useState('벽걸이');
  const [qty, setQty] = useState(1);
  const [basePrice, setBasePrice] = useState(DEFAULT_PRICES['벽걸이']);
  const [discountType, setDiscountType] = useState('none');
  const [discountVal, setDiscountVal] = useState('');
  const [payment, setPayment] = useState('현금');
  const [bookDate, setBookDate] = useState(() => {
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    return tmr.toISOString().split('T')[0];
  });
  const [bookTimeType, setBookTimeType] = useState('09:00');
  const [bookTimeCustom, setBookTimeCustom] = useState('14:00');
  const [assignee, setAssignee] = useState('ccy6208'); // 작업 담당자 기본값
  const [isCompleted, setIsCompleted] = useState(false); // 완료 상태 유지용

  useEffect(() => {
    if (editingId) return;
    let targetProduct = product;
    if (!CATEGORIES[category].includes(product)) {
      targetProduct = CATEGORIES[category][0];
      setProduct(targetProduct);
    }
    setBasePrice(DEFAULT_PRICES[targetProduct] || 0);
  }, [category, product]);

  const finalPrice = useMemo(() => {
    let totalBase = (Number(basePrice) || 0) * (Number(qty) || 1);
    const dVal = Number(discountVal) || 0;

    if (discountType === 'percent') {
      totalBase = Math.max(0, totalBase - (totalBase * (dVal / 100)));
    } else if (discountType === 'amount') {
      totalBase = Math.max(0, totalBase - dVal);
    }

    // 현금 결제이면서 영수증/계산서 필요시 10% 부가세 추가 (원단위 내림 처리)
    if (payment === '현금' && (hasCashReceipt || hasTaxInvoice)) {
      totalBase = Math.floor(totalBase * 1.1);
    }

    return totalBase;
  }, [basePrice, qty, discountType, discountVal, payment, hasCashReceipt, hasTaxInvoice]);

  const handleSaveBooking = async () => {
    if (!customerName.trim() || !newPhone.trim() || !address.trim()) {
      alert('성함, 전화번호, 기본 주소를 모두 입력해주세요.');
      return;
    }

    if (!editingId) {
      const isDuplicate = customers.some(c =>
        c.book_date === bookDate &&
        c.book_time_type === bookTimeType &&
        (bookTimeType !== '직접입력' || c.book_time_custom === bookTimeCustom)
      );
      if (isDuplicate) {
        if (!window.confirm('⚠️ 선택하신 날짜/시간에 이미 다른 예약이 있습니다. 계속 저장하시겠습니까?')) {
          return;
        }
      }
    }

    const entry = {
      user_id: session.user.id,
      business_id: myBusinessId,
      customer_name: customerName,
      phone: newPhone.replace(/[^0-9]/g, ''),
      address: address,
      address_detail: addressDetail,
      has_cash_receipt: payment === '현금' ? hasCashReceipt : false,
      has_tax_invoice: payment === '현금' ? hasTaxInvoice : false,
      memo: newMemo,
      category, product, quantity: qty,
      base_price: basePrice,
      discount_type: discountType,
      discount_value: discountVal || 0,
      final_price: finalPrice,
      payment_method: payment,
      book_date: bookDate,
      book_time_type: bookTimeType,
      book_time_custom: bookTimeType === '직접입력' ? bookTimeCustom : null,
      assignee: assignee || 'ccy6208',
      is_completed: isCompleted,
      date_created: getTodayStr(),
    };

    let error;
    if (editingId) {
      const { error: updErr } = await supabase.from('bookings').update(entry).eq('id', editingId);
      error = updErr;
      if (!error) alert('예약이 수정되었습니다.');
    } else {
      const { error: insErr } = await supabase.from('bookings').insert([entry]);
      error = insErr;
    }

    if (error) {
      alert('저장 실패: ' + error.message);
      return;
    }

    await fetchCustomers();
    setEditingId(null);
    setCustomerName(''); setNewPhone(''); setAddress(''); setAddressDetail(''); setNewMemo('');
    setHasCashReceipt(false); setHasTaxInvoice(false);
    setCurrentTab('calendar');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setCustomerName(''); setNewPhone(''); setAddress(''); setAddressDetail(''); setNewMemo('');
    setHasCashReceipt(false); setHasTaxInvoice(false);
    setCurrentTab('calendar');
  };

  // ==========================================
  // [탭: 설정 (Settings)]
  // ==========================================
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editBusinessPhone, setEditBusinessPhone] = useState('');
  const [editLogoFile, setEditLogoFile] = useState(null);
  const [editNickname, setEditNickname] = useState(''); // 본인 닉네임 설정
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    if (currentTab === 'settings') {
      setEditCompanyName(businessProfile.company_name);
      setEditBusinessPhone(businessProfile.phone || '');
      setEditLogoFile(null);
      setEditNickname(myNickname || '');
    }
  }, [currentTab, businessProfile]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setIsSavingSettings(true);
    let logoUrl = businessProfile.logo_url;

    if (editLogoFile) {
      const fileExt = editLogoFile.name.split('.').pop();
      const fileName = `${myBusinessId}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, editLogoFile, { upsert: true });

      if (uploadError) {
        alert('로고 업로드 실패: ' + uploadError.message);
        setIsSavingSettings(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage.from('logos').getPublicUrl(fileName);
      logoUrl = publicUrlData.publicUrl;
    }

    const upsertData = {
      id: myBusinessId,
      company_name: editCompanyName,
      phone: editBusinessPhone,
      logo_url: logoUrl,
    };

    const { error: bError } = await supabase.from('businesses').upsert([upsertData]);

    // 유저 프로필(닉네임) 저장 (현재 로그인된 user.id 기준)
    const { error: pError } = await supabase.from('profiles').upsert([{
      id: session.user.id,
      business_id: myBusinessId,
      nickname: editNickname
    }]);

    if (bError || pError) {
      alert('프로필 저장 실패: ' + (bError?.message || pError?.message));
    } else {
      setBusinessProfile(upsertData);
      setMyNickname(editNickname);
      alert('업체 정보 및 내 닉네임이 성공적으로 업데이트되었습니다.');
      fetchTeamMembers(); // 업데이트 후 팀원 목록 즉시 갱신
    }
    setIsSavingSettings(false);
  };

  // ==========================================
  // [탭: 지출 관리 (Expenses)]
  // ==========================================
  const [exAmount, setExAmount] = useState('');
  const [exCategory, setExCategory] = useState('자재/장비');
  const [exMemo, setExMemo] = useState('');
  const [exReceiptFile, setExReceiptFile] = useState(null);
  const [isSavingExpense, setIsSavingExpense] = useState(false);

  const handleSaveExpense = async (e) => {
    e.preventDefault();
    if (!exAmount) return alert('지출 금액을 입력해 주세요.');
    setIsSavingExpense(true);

    let receiptUrl = null;
    if (exReceiptFile) {
      const fileExt = exReceiptFile.name.split('.').pop();
      const fileName = `${myBusinessId}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('receipts').upload(fileName, exReceiptFile);
      if (uploadError) {
        alert('영수증 이미지 업로드 실패: ' + uploadError.message);
        setIsSavingExpense(false);
        return;
      }
      const { data } = supabase.storage.from('receipts').getPublicUrl(fileName);
      receiptUrl = data.publicUrl;
    }

    const { error } = await supabase.from('expenses').insert([{
      user_id: session.user.id,
      business_id: myBusinessId,
      amount: parseInt(exAmount.toString().replace(/[^0-9]/g, '') || 0),
      category: exCategory,
      memo: exMemo,
      receipt_url: receiptUrl,
      date_created: getTodayStr()
    }]);

    if (error) {
      alert('지출 저장 실패: ' + error.message);
    } else {
      alert('지출이 성공적으로 등록되었습니다!');
      setExAmount(''); setExMemo(''); setExReceiptFile(null);
      fetchExpenses();
    }
    setIsSavingExpense(false);
  };

  // ==========================================
  // [세무 대시보드 계산]
  // ==========================================
  const calcTax = () => {
    const currentMonthStr = getTodayStr().slice(0, 7); // 'YYYY-MM'

    // 이번 달 과세 매출: 카드 결제이거나, (현금이면서 증빙 체크가 된 경우)
    const taxableSales = customers.filter(c => {
      if (!c.book_date?.startsWith(currentMonthStr)) return false;
      if (c.payment_method === '카드') return true;
      if (c.payment_method === '현금' && (c.has_cash_receipt || c.has_tax_invoice)) return true;
      return false;
    }).reduce((acc, c) => acc + c.final_price, 0);

    const salesTax = Math.floor(taxableSales * 0.1);

    // 이번 달 지출 내역
    const thisMonthExpenses = expenses.filter(e => e.date_created?.startsWith(currentMonthStr))
      .reduce((acc, e) => acc + e.amount, 0);

    const purchaseTax = Math.floor(thisMonthExpenses * 0.1);

    return {
      taxableSales,
      salesTax,
      thisMonthExpenses,
      purchaseTax,
      finalTax: Math.max(0, salesTax - purchaseTax)
    };
  };

  // ==========================================
  // [대시보드 보조 함수]
  // ==========================================
  const calcDashboard = (dateStr) => {
    const list = customers.filter(c => c.book_date === dateStr);
    let total = 0, cash = 0, card = 0;
    list.forEach(c => {
      total += c.final_price;
      if (c.payment_method === '현금') cash += c.final_price;
      if (c.payment_method === '카드') card += c.final_price;
    });
    return { total, cash, card, list };
  };

  // ==========================================
  // [탭: 일정/달력 (Calendar)]
  // ==========================================
  const [calDate, setCalDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(getTodayStr());

  const getCalendarDays = () => {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      const pYear = year;
      const pMonth = String(month + 1).padStart(2, '0');
      const pDay = String(i).padStart(2, '0');
      days.push(`${pYear}-${pMonth}-${pDay}`);
    }
    return days;
  };

  const todayTargetList = useMemo(() => customers.filter(c => c.book_date === getTodayStr()), [customers]);
  const [batchSmsIdx, setBatchSmsIdx] = useState(-1);

  const handleSendSms = (c) => {
    const msg = `[안내] 오늘 방문 예정입니다. 시간 맞춰 뵙겠습니다.\n- 클린브로 (${c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type})`;
    window.location.href = `sms:${c.phone}?body=${encodeURIComponent(msg)}`;
  };

  const handleBatchSmsNext = () => {
    if (batchSmsIdx + 1 < todayTargetList.length) {
      const nextIdx = batchSmsIdx + 1;
      setBatchSmsIdx(nextIdx);
      handleSendSms(todayTargetList[nextIdx]);
    } else {
      alert('일괄 발송 준비가 끝났습니다.');
      setBatchSmsIdx(-1);
    }
  };

  // ==========================================
  // [탭: 통계 (Stats)]
  // ==========================================
  const [statStart, setStatStart] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0];
  });
  const [statEnd, setStatEnd] = useState(getTodayStr());

  const statsData = useMemo(() => {
    const list = customers.filter(c => c.book_date >= statStart && c.book_date <= statEnd);
    let total = 0, cash = 0, card = 0, unpaid = 0;
    list.forEach(c => {
      total += c.final_price;
      if (c.payment_method === '현금') cash += c.final_price;
      if (c.payment_method === '카드') card += c.final_price;
      if (c.payment_method === '미결제') unpaid += c.final_price;
    });
    return { total, cash, card, unpaid, list };
  }, [customers, statStart, statEnd]);

  const monthlyCompare = useMemo(() => {
    const now = new Date();
    const thisYear = now.getFullYear(), thisMonth = now.getMonth();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    let thisMTotal = 0, lastMTotal = 0;
    customers.forEach(c => {
      const d = new Date(c.book_date);
      if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) thisMTotal += c.final_price;
      if (d.getFullYear() === lastYear && d.getMonth() === lastMonth) lastMTotal += c.final_price;
    });

    const maxVal = Math.max(thisMTotal, lastMTotal, 1);
    return {
      thisMTotal, lastMTotal,
      thisPct: (thisMTotal / maxVal) * 100,
      lastPct: (lastMTotal / maxVal) * 100
    };
  }, [customers]);

  // 아이템 컴포넌트
  const BookingItem = ({ c }) => {
    const longPressHooks = useLongPress(() => {
      const action = window.prompt('수정하려면 1, 삭제하려면 2를 입력하세요.\n(취소는 빈칸)');
      if (action === '1') handleEdit(c);
      else if (action === '2') handleDelete(c.id);
    }, 600);

    return (
      <div {...longPressHooks} className={`relative p-5 rounded-[1.5rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border-0 transition-all active:scale-[0.98] ${c.is_completed ? 'bg-slate-50 dark:bg-slate-800/50 opacity-60' : 'bg-white dark:bg-slate-800'}`}>

        {/* 완료 상태 뱃지 및 안개 효과 */}
        {c.is_completed && (
          <div className="absolute top-0 right-0 p-2 text-green-600 font-bold flex items-center gap-1 bg-green-50 rounded-bl-[1.5rem] rounded-tr-[1.5rem]">
            <span className="material-symbols-outlined text-sm">task_alt</span> 완료됨
          </div>
        )}

        <div className="flex justify-between items-start mb-2 mt-1">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${c.assignee?.includes('2인') ? 'bg-purple-50 text-purple-600 border-purple-200' : c.assignee === '파트너' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-indigo-50 text-indigo-600 border-indigo-200'}`}>
                👤 {c.assignee}
              </span>
              <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded">
                {c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type}
              </span>
              <span className="text-slate-500 text-xs font-medium">{c.category} &gt; {c.product} ({c.quantity}대)</span>
            </div>
            <h4
              onClick={(e) => { e.stopPropagation(); setMapPopupMemo(c.address || c.memo); }}
              className={`font-bold text-base cursor-pointer hover:text-primary flex items-center transition-colors ${c.is_completed ? 'text-slate-500 line-through decoration-2' : 'text-slate-800 dark:text-slate-100'}`}
            >
              {c.customer_name || (c.memo ? c.memo.split(' ')[0] : '고객')}
              {c.address && <span className="text-[13px] font-medium text-slate-500 ml-1.5">({c.address.split(' ').slice(0, 2).join(' ')})</span>}
              <span className="material-symbols-outlined text-[16px] ml-1.5 text-blue-500 bg-blue-50 p-0.5 rounded-full border border-blue-200">location_on</span>
            </h4>
            <p className="text-slate-400 font-mono text-sm">{c.phone ? c.phone.replace(/^(\d{2,3})(\d{3,4})(\d{4})$/, `$1-$2-$3`) : '번호 없음'}</p>
            {c.memo && <p className="text-xs text-slate-500 mt-1 line-clamp-1">{c.memo}</p>}
            <div className="flex items-center gap-2 mt-2">
              <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${c.sms_sent_initial ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                <span className="material-symbols-outlined text-[12px]">sms</span> 안내 문자
              </span>
              <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${c.sms_sent_reminder ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                <span className="material-symbols-outlined text-[12px]">alarm</span> 알림 문자
              </span>
            </div>
          </div>
          <div className="text-right pt-6">
            <p className="font-bold text-primary text-lg">{fmtNum(c.final_price)}원</p>
            <div className="flex flex-col items-end gap-1 mt-1">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${c.payment_method === '현금' ? 'text-green-600 bg-green-50 border-green-200' : c.payment_method === '카드' ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-slate-600 bg-slate-50 border-slate-200'}`}>
                {c.payment_method || '미결제'}
              </span>
              {c.has_cash_receipt && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded border border-slate-200">현금영수증</span>}
              {c.has_tax_invoice && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded border border-slate-200">세금계산서</span>}
            </div>
          </div>
        </div>

        {/* 하단 액션 버튼들 */}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => handleEdit(c)} className="text-xs px-3 py-1.5 rounded-lg border font-bold transition-colors bg-white text-slate-500 border-slate-300 hover:bg-slate-50 shadow-sm">
            ✏️ 수정하기
          </button>
          <button onClick={() => toggleCompletion(c)} className={`text-xs px-3 py-1.5 rounded-lg border font-bold transition-colors shadow-sm ${c.is_completed ? 'bg-slate-50 text-slate-500 border-slate-300 hover:bg-slate-100' : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'}`}>
            {c.is_completed ? '작업 취소 (미완료로 변경)' : '✨ 작업 완료 체크하기'}
          </button>
        </div>
      </div>
    );
  };

  // --- 로그인 처리 안되었을 시 화면 출력 ---
  if (!session) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-indigo-900 via-blue-900 to-purple-900">
        <div className="relative z-10 bg-white w-full max-w-sm px-8 pt-12 pb-10 rounded-[2rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] border border-white/20 backdrop-blur-sm">
          <div className="text-center mb-10">
            {/* 상단 장식 이모티콘 추가 */}
            <div className="flex justify-center items-center gap-3 mb-4 select-none animate-fade-in relative">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-blue-200/50 transform -rotate-6">
                ✨
              </div>
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-3xl flex items-center justify-center text-3xl shadow-lg shadow-indigo-500/30 transform scale-110 z-10">
                🌬️
              </div>
              <div className="w-14 h-14 bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-blue-200/50 transform rotate-6">
                🫧
              </div>
            </div>

            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight drop-shadow-sm">
              {isLoginMode ? '로그인' : '회원가입'}
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-2">
              신뢰할 수 있는 파트너십의 시작
            </p>
          </div>

          <form onSubmit={handleAuth}>
            <div className="space-y-6">
              <div className="relative group">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 group-focus-within:text-blue-600 transition-colors">person</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full border-2 border-blue-100 rounded-2xl py-3.5 pl-12 pr-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-[15px] placeholder-slate-400 text-slate-800 bg-blue-50/30 transition-all font-semibold"
                  placeholder="아이디를 입력하세요"
                />
              </div>
              <div className="relative group">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 group-focus-within:text-blue-600 transition-colors">lock</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full border-2 border-blue-100 rounded-2xl py-3.5 pl-12 pr-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-[15px] placeholder-slate-400 text-slate-800 bg-blue-50/30 transition-all font-semibold"
                  placeholder="비밀번호를 입력하세요"
                />
              </div>

              {!isLoginMode && (
                <div className="relative group animate-slide-up">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 group-focus-within:text-blue-600 transition-colors">group_add</span>
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    className="w-full border-2 border-blue-100 rounded-2xl py-3.5 pl-12 pr-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-[15px] placeholder-slate-400 text-slate-800 bg-blue-50/30 transition-all font-semibold"
                    placeholder="초대 코드 (선택사항)"
                  />
                </div>
              )}
            </div>

            <div className="mt-10">
              <button
                disabled={authLoading}
                type="submit"
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-[17px] tracking-wide shadow-xl shadow-blue-500/30 hover:from-blue-700 hover:to-indigo-700 hover:shadow-blue-600/40 active:scale-[0.98] transition-all flex items-center justify-center transform"
              >
                {authLoading ? (
                  <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
                ) : (
                  isLoginMode ? '로그인' : '회원가입'
                )}
              </button>
            </div>
          </form>

          <div className="mt-8 text-center pt-6 border-t border-slate-100">
            <button
              onClick={() => setIsLoginMode(!isLoginMode)}
              type="button"
              className="text-[14px] font-bold text-slate-500 hover:text-blue-600 transition-colors"
            >
              {isLoginMode ? '처음이신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 메인 앱 ---
  const userName = session.user.email.split('@')[0];
  const isCeo = userName.includes('admin') || userName.includes('ceo') || userName.includes('master');
  const roleName = isCeo ? '대표님' : '파트너님';

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-900 pb-24 text-slate-900 dark:text-slate-100 font-display">

      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md px-5 py-4 flex justify-between items-center">
        <div className="flex gap-2 items-center">
          {businessProfile.logo_url ? (
            <img src={businessProfile.logo_url} alt="Logo" className="w-8 h-8 object-contain rounded-full border border-slate-200 bg-white shadow-sm" />
          ) : (
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-black text-sm shadow-sm">
              {businessProfile.company_name.substring(0, 1)}
            </div>
          )}
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight flex items-center gap-1">
            {businessProfile.company_name}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-slate-400 hover:text-blue-500 transition-colors">
            <span className="material-symbols-outlined text-[26px]">notifications</span>
          </button>
          <div
            onClick={() => { if (window.confirm('로그아웃 하시겠습니까?')) handleLogout(); }}
            className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm shadow-sm border border-blue-200 cursor-pointer hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
            title="로그아웃"
          >
            {userName.substring(0, 1).toUpperCase()}
          </div>
        </div>
      </header>

      {loadingData && (
        <div className="text-center p-2 text-xs text-primary font-bold animate-pulse">동기화 중...</div>
      )}

      {/* ======================= [탭 1: 일정 / 달력] ======================= */}
      {currentTab === 'calendar' && (
        <main className="flex-1 max-w-lg mx-auto w-full flex flex-col space-y-4 pt-4 px-4 overflow-x-hidden">

          {/* 아침 알림 리스트 */}
          {todayTargetList.length > 0 && selectedDate === getTodayStr() && (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-700 p-5 rounded-[1.5rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border-0 animate-fade-in">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-primary flex items-center gap-1">
                  <span className="material-symbols-outlined text-[18px]">notifications_active</span>오늘 방문 예정 ({todayTargetList.length})
                </h3>
                <button onClick={handleBatchSmsNext} className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg font-bold shadow-sm active:scale-95 transition-all">
                  {batchSmsIdx >= 0 ? '다음 문자 준비 ➔' : '문자 일괄 준비 시작'}
                </button>
              </div>
              <div className="space-y-2">
                {todayTargetList.map((c, i) => (
                  <div key={c.id} className={`flex items-center justify-between bg-white dark:bg-slate-900/50 p-2.5 rounded-xl border ${i === batchSmsIdx ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200 dark:border-slate-700'}`}>
                    <div className="flex items-center gap-3">
                      <span className="bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded text-xs font-bold text-slate-600 dark:text-slate-300">
                        {c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type}
                      </span>
                      <p className="font-semibold text-sm truncate max-w-[120px]">{c.memo}</p>
                    </div>
                    <button onClick={() => handleSendSms(c)} className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1.5 rounded-lg border border-blue-200 active:scale-95">
                      <span className="material-symbols-outlined text-[14px]">sms</span> 문자
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 대시보드 */}
          {(() => {
            const todayDash = calcDashboard(selectedDate);
            return (
              <div className="bg-white dark:bg-slate-800 p-6 rounded-[1.5rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border-0">
                <p className="text-xs font-bold text-slate-400 mb-1">{selectedDate === getTodayStr() ? '오늘의 합계 매출' : `${selectedDate.split('-')[1]}월 ${selectedDate.split('-')[2]}일 매출`}</p>
                <div className="text-3xl font-black text-primary mb-3">
                  {fmtNum(todayDash.total)}<span className="text-lg text-slate-400 font-bold ml-1">원</span>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 p-2 rounded-xl text-center">
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-bold">현금 합계</p>
                    <p className="text-sm font-bold text-green-800 dark:text-green-300">{fmtNum(todayDash.cash)}원</p>
                  </div>
                  <div className="flex-1 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 p-2 rounded-xl text-center">
                    <p className="text-[10px] text-blue-700 dark:text-blue-400 font-bold">카드 합계</p>
                    <p className="text-sm font-bold text-blue-800 dark:text-blue-300">{fmtNum(todayDash.card)}원</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 캘린더 구역 */}
          <div className="bg-white dark:bg-slate-800 p-5 rounded-[1.5rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border-0 mb-4">
            <div className="flex justify-between items-center mb-4">
              <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1))} className="p-1 text-slate-400 hover:text-primary">
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <h2 className="font-bold text-lg">{calDate.getFullYear()}년 {calDate.getMonth() + 1}월</h2>
              <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1))} className="p-1 text-slate-400 hover:text-primary">
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-400 mb-2">
              <div className="text-red-400">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div className="text-blue-400">토</div>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {getCalendarDays().map((dStr, idx) => {
                if (!dStr) return <div key={`empty-${idx}`} className="h-14"></div>;

                const dList = customers.filter(c => c.book_date === dStr);
                const hasMorning = dList.some(c => c.book_time_type === '오전' || (parseInt((c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type)?.split(':')[0]) < 12));
                const hasAfternoon = dList.some(c => c.book_time_type === '오후' || (parseInt((c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type)?.split(':')[0]) >= 12));
                const dObj = new Date(dStr);
                const isToday = dStr === getTodayStr();
                const isSelected = dStr === selectedDate;

                return (
                  <div
                    key={dStr}
                    onClick={() => setSelectedDate(dStr)}
                    className={`h-14 flex flex-col items-center pt-1 border relative cursor-pointer transition-colors rounded-xl
                      ${isSelected ? 'bg-primary/10 border-primary ring-1 ring-primary' : 'bg-slate-50 dark:bg-slate-900 border-transparent hover:bg-slate-100'}
                    `}
                  >
                    <span className={`text-sm font-semibold ${dObj.getDay() === 0 ? 'text-red-500' : dObj.getDay() === 6 ? 'text-blue-500' : 'text-slate-700 dark:text-slate-300'} ${isToday && !isSelected ? 'underline decoration-primary decoration-2 underline-offset-4' : ''}`}>
                      {dObj.getDate()}
                    </span>
                    <div className="flex gap-0.5 mt-1 flex-wrap justify-center px-0.5">
                      {hasMorning && <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>}
                      {hasAfternoon && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>}
                      {dList.length > 0 && !hasMorning && !hasAfternoon && <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 선택된 날짜의 리스트 */}
          <div>
            <h3 className="font-bold text-sm text-slate-600 dark:text-slate-400 mb-2 px-1 flex justify-between">
              <span>{selectedDate.split('-')[2]}일 예약 리스트</span>
              <span className="font-normal text-xs">(항목을 길게 누르면 수정/삭제)</span>
            </h3>
            {calcDashboard(selectedDate).list.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm bg-white/50 dark:bg-slate-800/50 rounded-[1.5rem]">
                예약이 없습니다.
              </div>
            ) : (
              <div className="space-y-3 pb-8">
                {calcDashboard(selectedDate).list.map(c => <BookingItem key={c.id} c={c} />)}
              </div>
            )}
          </div>
        </main>
      )}


      {/* ======================= [탭 2: 예약 등록/수정 (Add View)] ======================= */}
      {currentTab === 'add' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-5 animate-slide-up">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-2xl font-black">{editingId ? '예약 수정' : '새 예약 추가'}</h2>
            {editingId && (
              <button onClick={handleCancelEdit} className="text-sm font-bold text-slate-500 bg-slate-200 px-3 py-1 rounded-lg">취소</button>
            )}
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-5">

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-primary border-b border-primary/20 pb-1">1. 기본 정보</h3>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">성함</label>
                <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="고객님 성함" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">전화번호</label>
                <input type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="010-0000-0000" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">주소</label>
                <div className="flex gap-2 mb-2">
                  <input type="text" readOnly value={address} placeholder="주소 검색 버튼을 눌러주세요" className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 rounded-xl p-3 text-sm outline-none text-slate-500" />
                  <button type="button" onClick={() => {
                    new window.daum.Postcode({
                      oncomplete: function (data) {
                        setAddress(data.address);
                        setAddressDetail('');
                      }
                    }).open();
                  }} className="bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1 active:scale-95 transition-all w-[120px] shrink-0">
                    <span className="material-symbols-outlined text-[18px]">search</span> 주소 검색
                  </button>
                </div>
                <input type="text" value={addressDetail} onChange={e => setAddressDetail(e.target.value)} placeholder="상세 주소 (동/호수)" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">요약 메모 / 특이사항</label>
                <input type="text" value={newMemo} onChange={e => setNewMemo(e.target.value)} placeholder="참고사항을 적어주세요" className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none" />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-primary border-b border-primary/20 pb-1">2. 제품 상세 선택</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">카테고리</label>
                  <select value={category} onChange={e => setCategory(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none">
                    {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">제품 종류</label>
                  <select value={product} onChange={e => setProduct(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none">
                    {CATEGORIES[category].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">대수</label>
                  <div className="relative">
                    <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-right focus:ring-2 focus:ring-primary pr-8" />
                    <span className="absolute right-3 top-3 text-xs text-slate-400 font-bold">대</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">기본 단가 (1대당)</label>
                  <div className="relative">
                    <input type="number" value={basePrice} onChange={e => setBasePrice(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-right focus:ring-2 focus:ring-primary pr-8" />
                    <span className="absolute right-3 top-3 text-xs text-slate-400 font-bold">원</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">할인 방식</label>
                    <select value={discountType} onChange={e => setDiscountType(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-primary outline-none">
                      <option value="none">할인 없음</option>
                      <option value="percent">퍼센트 (%)</option>
                      <option value="amount">금액 (원)</option>
                    </select>
                  </div>
                  {discountType !== 'none' && (
                    <div className="flex-1 animate-fade-in">
                      <label className="block text-xs font-semibold text-slate-500 mb-1">할인 값</label>
                      <div className="relative">
                        <input type="number" value={discountVal} onChange={e => setDiscountVal(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg p-2 text-sm text-right focus:ring-2 pr-6" />
                        <span className="absolute right-2 top-2 text-xs font-bold text-slate-400">{discountType === 'percent' ? '%' : '원'}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 실시간 합계 금액 표시 구역 */}
              <div className="mt-4 bg-gradient-to-r from-primary to-indigo-600 p-4 rounded-xl shadow-md text-white flex justify-between items-center">
                <span className="text-sm font-bold opacity-80">최초 합계: {(Number(basePrice) || 0) * (Number(qty) || 1)}원<br />최종 합계 금액</span>
                <span className="text-2xl font-black">{fmtNum(finalPrice)}원</span>
              </div>
            </div>

            {/* 3. 일정 및 결제수단 */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-primary border-b border-primary/20 pb-1">3. 예약 일정 및 결제</h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">방문 날짜</label>
                  <input type="date" value={bookDate} onChange={e => setBookDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">방문 시간대</label>
                  <select value={bookTimeType} onChange={e => setBookTimeType(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2">
                    {Array.from({ length: 16 }, (_, i) => i + 7).map(hour => {
                      const timeStr = `${String(hour).padStart(2, '0')}:00`;
                      return <option key={timeStr} value={timeStr}>{timeStr}</option>;
                    })}
                    <option value="직접입력">직접 입력 (분 단위 등)</option>
                  </select>
                </div>
              </div>

              {bookTimeType === '직접입력' && (
                <div className="animate-slide-up">
                  <input type="time" value={bookTimeCustom} onChange={e => setBookTimeCustom(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">작업 담당자 지정</label>
                  <select
                    value={assignee}
                    onChange={e => setAssignee(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 bg-white"
                  >
                    {[...new Set(['ccy6208', myNickname, ...teamMembers, '파트너'])].filter(Boolean).map(nickname => (
                      <option key={nickname} value={nickname}>{nickname}</option>
                    ))}
                    <option value="2인 1조 팀">2인 1조 팀</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-2">결제 수단</label>
                  <div className="flex gap-2 text-xs mb-3">
                    {['현금', '카드'].map(pay => (
                      <button
                        key={pay} onClick={() => setPayment(pay)}
                        className={`flex-1 py-2 rounded-lg font-bold transition-all border ${payment === pay ? 'bg-primary/10 text-primary border-primary/20 shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border-slate-200'}`}
                      >
                        {pay}
                      </button>
                    ))}
                  </div>
                  {payment === '현금' && (
                    <div className="space-y-2 animate-fade-in bg-slate-50 dark:bg-slate-900 border border-slate-200 rounded-lg p-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={hasCashReceipt} onChange={(e) => setHasCashReceipt(e.target.checked)} className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary" />
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400">현금영수증 필요</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={hasTaxInvoice} onChange={(e) => setHasTaxInvoice(e.target.checked)} className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary" />
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400">세금계산서 필요</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

          <button onClick={handleSaveBooking} className="w-full py-4 bg-primary text-white text-lg font-black rounded-2xl shadow-lg shadow-primary/30 active:scale-95 transition-transform flex justify-center gap-2 items-center">
            <span className="material-symbols-outlined">cloud_upload</span>
            {editingId ? '클라우드에 예약 수정 완료' : '클라우드에 예약 저장하기'}
          </button>

        </main>
      )}


      {/* ======================= [탭 3: 통계 / 필터링] ======================= */}
      {currentTab === 'stats' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-6">
          <h2 className="text-2xl font-black mb-2">클라우드 매출 통계</h2>

          <div className="bg-white dark:bg-slate-800 p-5 rounded-[1.5rem] border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 mb-1">시작일</label>
              <input type="date" value={statStart} onChange={e => setStatStart(e.target.value)} className="w-full p-2 bg-slate-50 border rounded-lg text-sm" />
            </div>
            <div className="text-slate-400 font-bold mb-2">~</div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 mb-1">종료일</label>
              <input type="date" value={statEnd} onChange={e => setStatEnd(e.target.value)} className="w-full p-2 bg-slate-50 border rounded-lg text-sm" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-[1.5rem] p-6 text-white shadow-lg shadow-slate-900/20 relative overflow-hidden">
            <span className="material-symbols-outlined absolute -right-4 -bottom-4 text-[100px] text-white/5 font-fill">monitoring</span>
            <p className="text-sm font-medium text-slate-300 mb-1">해당 기간 총 매출</p>
            <p className="text-4xl font-black mb-4">{fmtNum(statsData.total)}<span className="text-xl ml-1 font-bold text-slate-400">원</span></p>

            <div className="flex gap-4">
              <div className="flex-1">
                <p className="text-[11px] text-slate-400 font-bold">현금 합계</p>
                <p className="text-base font-bold text-green-400">{fmtNum(statsData.cash)}원</p>
              </div>
              <div className="flex-1">
                <p className="text-[11px] text-slate-400 font-bold">카드 합계</p>
                <p className="text-base font-bold text-blue-400">{fmtNum(statsData.card)}원</p>
              </div>
              <div className="flex-1 border-l border-white/10 pl-4">
                <p className="text-[11px] text-slate-400 font-bold">미결제</p>
                <p className="text-base font-bold text-red-400">{fmtNum(statsData.unpaid)}원</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-[1.5rem] border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
            <h3 className="font-bold text-sm text-slate-600 mb-4 flex items-center gap-1">
              <span className="material-symbols-outlined text-[18px]">bar_chart</span>
              이번 달 vs 지난 달 매출 비교
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span className="text-slate-500">지난 달</span>
                  <span className="text-slate-700">{fmtNum(monthlyCompare.lastMTotal)}원</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div className="bg-slate-300 h-full rounded-full transition-all duration-1000" style={{ width: `${monthlyCompare.lastPct}%` }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-bold mb-1">
                  <span className="text-primary">이번 달</span>
                  <span className="text-primary">{fmtNum(monthlyCompare.thisMTotal)}원</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div className="bg-primary h-full rounded-full transition-all duration-1000" style={{ width: `${monthlyCompare.thisPct}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-bold text-sm text-slate-600 mb-2 px-1">조회된 결제 리스트 ({statsData.list.length}건)</h3>
            <div className="space-y-2">
              {statsData.list.map(c => (
                <div key={c.id} className="bg-white dark:bg-slate-800 flex justify-between p-4 rounded-2xl border-0 shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] text-sm">
                  <div>
                    <span
                      onClick={(e) => { e.stopPropagation(); setMapPopupMemo(c.memo); }}
                      className="font-bold cursor-pointer hover:text-primary transition-colors flex items-center gap-1"
                    >
                      {c.memo}
                      <span className="material-symbols-outlined text-[14px] text-blue-500">location_on</span>
                    </span>
                    <span className="text-xs text-slate-400 ml-1">{c.book_date}</span>
                  </div>
                  <div className="font-bold">
                    <span className={`text-[10px] mr-2 px-1.5 py-0.5 rounded border ${c.payment_method === '현금' ? 'text-green-600 border-green-200' : c.payment_method === '카드' ? 'text-blue-600 border-blue-200' : 'text-red-400 border-red-200'}`}>{c.payment_method}</span>
                    {fmtNum(c.final_price)}원
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* ======================= [탭 4: 프로필 설정] ======================= */}
      {currentTab === 'settings' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-5 animate-slide-up">
          <h2 className="text-2xl font-black mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">storefront</span> 업체 프로필 설정
          </h2>

          <form onSubmit={handleSaveProfile} className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">업체명</label>
              <input type="text" required value={editCompanyName} onChange={e => setEditCompanyName(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-primary" placeholder="업체명 입력" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">내 닉네임 (작업 담당자 노출용)</label>
              <input type="text" required value={editNickname} onChange={e => setEditNickname(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-primary" placeholder="예: 구로구점 김길동, 마스터" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">대표 연락처</label>
              <input type="tel" value={editBusinessPhone} onChange={e => setEditBusinessPhone(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-primary" placeholder="예: 1588-0000" />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">업체 자체 로고 업로드 (이미지 파일)</label>
              {businessProfile.logo_url && (
                <div className="mb-3">
                  <p className="text-[10px] text-slate-400 mb-1">현재 적용된 로고:</p>
                  <img src={businessProfile.logo_url} alt="Current Logo" className="w-20 h-20 object-contain rounded-lg border bg-slate-50" />
                </div>
              )}
              <input type="file" accept="image/*" onChange={e => setEditLogoFile(e.target.files[0])} className="w-full p-2 text-sm border rounded-xl" />
              <p className="text-[10px] text-slate-400 mt-1">선택하면 로고가 덮어씌어 저장됩니다.</p>
            </div>

            <button disabled={isSavingSettings} type="submit" className="w-full py-4 bg-slate-800 text-white text-lg font-black rounded-xl shadow-md active:scale-95 transition-transform flex justify-center items-center gap-2">
              <span className="material-symbols-outlined">{isSavingSettings ? 'sync' : 'save'}</span>
              {isSavingSettings ? '업데이트 중...' : '프로필 저장하기'}
            </button>
          </form>

          <div className="text-center">
            <p className="text-xs text-slate-400 font-bold mb-1">우리 업체 식별 코드 (파트너 초대 시 필요)</p>
            <p className="text-[10px] bg-slate-200 p-2 rounded text-slate-600 break-all select-all font-mono">{myBusinessId}</p>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={handleLogout}
              className="w-full py-3.5 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 text-sm font-bold rounded-xl active:scale-95 transition-all flex justify-center items-center gap-2 border border-red-100 dark:border-red-900/30"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
              로그아웃
            </button>
          </div>
        </main>
      )}

      {/* ======================= [탭 5: 지출 관리] ======================= */}
      {currentTab === 'expenses' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-6 animate-slide-up">
          <h2 className="text-2xl font-black mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">receipt_long</span> 지출 관리
          </h2>

          <form onSubmit={handleSaveExpense} className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-5 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">지출 금액 (원)</label>
              <input type="text" required value={exAmount} onChange={e => setExAmount(fmtNum(e.target.value.replace(/[^0-9]/g, '')))} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold text-right focus:ring-2" placeholder="0" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">카테고리</label>
                <select value={exCategory} onChange={e => setExCategory(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2">
                  <option value="자재/장비">자재/장비</option>
                  <option value="유류비">유류비</option>
                  <option value="식대">식대</option>
                  <option value="기타">기타</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">영수증 캡쳐 (선택)</label>
                <input type="file" accept="image/*" onChange={e => setExReceiptFile(e.target.files[0])} className="w-full text-[10px] p-2 border rounded-xl" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">메모 (어디서 뭘 샀는지)</label>
              <input type="text" value={exMemo} onChange={e => setExMemo(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 outline-none focus:ring-2" placeholder="예: 철물점 마스킹 테이프" />
            </div>

            <button disabled={isSavingExpense} type="submit" className="w-full py-3.5 bg-primary text-white font-bold rounded-xl active:scale-95 transition-transform flex justify-center gap-2 items-center">
              <span className="material-symbols-outlined">{isSavingExpense ? 'sync' : 'add_circle'}</span>
              {isSavingExpense ? '저장 중...' : '지출 내역 등록'}
            </button>
          </form>

          <div>
            <h3 className="font-bold text-sm text-slate-600 mb-2 px-1">최근 지출 내역 ({expenses.length}건)</h3>
            <div className="space-y-2">
              {expenses.map(e => (
                <div key={e.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] text-sm border-0 flex justify-between items-center">
                  <div>
                    <span className="font-bold flex items-center gap-1">
                      {e.memo || e.category}
                      {e.receipt_url && <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded ml-1 font-bold">영수증 보기</a>}
                    </span>
                    <span className="text-xs text-slate-400 block mt-1">{e.date_created} · {e.category}</span>
                  </div>
                  <div className="font-black text-red-500">{fmtNum(e.amount)}원</div>
                </div>
              ))}
              {expenses.length === 0 && <p className="text-center text-xs text-slate-400 py-4">등록된 지출 내역이 없습니다.</p>}
            </div>
          </div>
        </main>
      )}

      {/* ======================= [탭 6: 세무 대시보드] ======================= */}
      {currentTab === 'tax' && (() => {
        const taxInfo = calcTax();
        return (
          <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-6 animate-slide-up">
            <h2 className="text-2xl font-black mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">account_balance</span> 이달의 세무 예측
            </h2>

            <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border-0">
              <p className="text-xs font-bold text-slate-400 text-center mb-6">이번 달 예상 부가가치세</p>

              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 dark:border-slate-700">
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">➕ 이번 달 과세 매출 부가세 (10%)</span>
                  <span className="font-black text-red-500">{fmtNum(taxInfo.salesTax)}원</span>
                  <p className="w-full text-[10px] text-slate-400 mt-1 col-span-2 text-right">과세매출 합계: {fmtNum(taxInfo.taxableSales)}원 (카드 및 현금영수증/계산서)</p>
                </div>

                <div className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 dark:border-slate-700">
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">➖ 이번 달 매입 공제 세액 (10%)</span>
                  <span className="font-black text-green-600">-{fmtNum(taxInfo.purchaseTax)}원</span>
                  <p className="w-full text-[10px] text-slate-400 mt-1 col-span-2 text-right">등록된 총 지출액 합계: {fmtNum(taxInfo.thisMonthExpenses)}원</p>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 text-center border overflow-hidden relative">
                <p className="text-xs font-bold text-slate-500 mb-1">최종 예상 납부 세액</p>
                <p className="text-3xl font-black text-primary">{fmtNum(taxInfo.finalTax)}원</p>
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 p-4 rounded-xl shadow-sm">
              <h4 className="font-bold text-yellow-800 dark:text-yellow-500 text-sm mb-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">lightbulb</span> 절세 가이드
              </h4>
              <ul className="text-xs text-yellow-700 dark:text-yellow-600/90 space-y-1.5 list-disc pl-4 font-medium break-keep">
                <li>사업용 소모품, 장비, 자재 구입 시 꼭 현금영수증(지출증빙) 또는 세금계산서를 수취하세요.</li>
                <li>업무용 주유비, 식대 카드 결제 내역도 지출 관리에 꼼꼼히 등록해 공제를 받으세요.</li>
                <li>위 세액은 단면적인 부가가치세(10%) 계산으로, 추가 공제 비율이나 사업소득에 대한 종합소득세는 별도로 세무사와 상담을 권장합니다.</li>
              </ul>
            </div>
          </main>
        );
      })()}

      {/* ==========================================
          [지도/네비게이션 팝업]
          ========================================== */}
      {mapPopupMemo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setMapPopupMemo(null)}>
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 dark:border-slate-700">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-black text-lg text-slate-800 dark:text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-blue-500">explore</span> 네비게이션
                </h3>
                <button onClick={() => setMapPopupMemo(null)} className="text-slate-400 hover:text-slate-600 bg-slate-100 rounded-full p-1">
                  <span className="material-symbols-outlined block">close</span>
                </button>
              </div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 p-2 rounded-lg line-clamp-2 break-keep">
                <span className="font-bold">목적지:</span> <span className="text-slate-800 dark:text-slate-200">{mapPopupMemo}</span>
              </p>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <a href={`nmap://search?query=${encodeURIComponent(mapPopupMemo)}`} className="flex flex-col items-center justify-center p-4 bg-green-50 hover:bg-green-100 border border-green-200 rounded-2xl transition-colors">
                <span className="font-extrabold text-green-600 mb-1">네이버 지도</span>
                <span className="text-[10px] text-green-700/70 font-bold">앱 열기</span>
              </a>
              <a href={`kakaomap://search?q=${encodeURIComponent(mapPopupMemo)}`} className="flex flex-col items-center justify-center p-4 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-2xl transition-colors text-center">
                <span className="font-extrabold text-yellow-600 mb-1 leading-tight">카카오맵</span>
                <span className="text-[10px] text-yellow-700/70 font-bold">앱 열기</span>
              </a>
              <a href={`tmap://search?name=${encodeURIComponent(mapPopupMemo)}`} className="flex flex-col items-center justify-center p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-2xl transition-colors text-center">
                <span className="font-extrabold text-blue-600 mb-1 leading-tight">티맵 (Tmap)</span>
                <span className="text-[10px] text-blue-700/70 font-bold">앱 열기</span>
              </a>
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapPopupMemo)}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl transition-colors text-center">
                <span className="font-extrabold text-slate-600 mb-1">구글맵</span>
                <span className="text-[10px] text-slate-500 font-bold">웹/앱 열기</span>
              </a>
              <a href={`https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent(mapPopupMemo)}`} target="_blank" rel="noopener noreferrer" className="col-span-2 flex flex-col items-center justify-center p-3 bg-green-600 hover:bg-green-700 text-white rounded-2xl transition-colors shadow-md shadow-green-600/20 mt-1">
                <span className="font-extrabold text-sm mb-0.5">앱이 없다면? (웹 브라우저)</span>
                <span className="text-[10px] opacity-80 font-bold">네이버 지도 웹으로 검색하기</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          [하단 네비게이션 탭]
          ========================================== */}
      <nav className="fixed bottom-0 w-full border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg px-2 pb-safe pt-2 z-40" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex gap-1 max-w-lg mx-auto justify-between">
          <button onClick={() => setCurrentTab('calendar')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'calendar' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'calendar' ? 'font-fill' : ''}`}>calendar_month</span>
            <p className={`text-[9px] ${currentTab === 'calendar' ? 'font-bold' : 'font-medium'}`}>홈</p>
          </button>

          <button onClick={() => setCurrentTab('add')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'add' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'add' ? 'font-fill' : ''}`}>edit_calendar</span>
            <p className={`text-[9px] ${currentTab === 'add' ? 'font-bold' : 'font-medium'}`}>예약</p>
          </button>

          <button onClick={() => setCurrentTab('stats')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'stats' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'stats' ? 'font-fill' : ''}`}>monitoring</span>
            <p className={`text-[9px] ${currentTab === 'stats' ? 'font-bold' : 'font-medium'}`}>통계</p>
          </button>

          <button onClick={() => setCurrentTab('expenses')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'expenses' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'expenses' ? 'font-fill' : ''}`}>receipt_long</span>
            <p className={`text-[9px] ${currentTab === 'expenses' ? 'font-bold' : 'font-medium'}`}>지출</p>
          </button>

          <button onClick={() => setCurrentTab('tax')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'tax' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'tax' ? 'font-fill' : ''}`}>account_balance</span>
            <p className={`text-[9px] ${currentTab === 'tax' ? 'font-bold' : 'font-medium'}`}>세무</p>
          </button>

          <button onClick={() => setCurrentTab('settings')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'settings' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'settings' ? 'font-fill' : ''}`}>manage_accounts</span>
            <p className={`text-[9px] ${currentTab === 'settings' ? 'font-bold' : 'font-medium'}`}>설정</p>
          </button>
        </div>
      </nav>

    </div>
  );
}

export default App;
