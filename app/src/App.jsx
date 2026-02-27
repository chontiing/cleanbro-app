import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabase';
import confetti from 'canvas-confetti';
import imageCompression from 'browser-image-compression';

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
  const [businessProfile, setBusinessProfile] = useState({
    company_name: '클린브로',
    phone: '',
    logo_url: '',
    monthly_target_revenue: 5000000,
    taxpayer_type: '간이과세자',
    default_completion_message: '',
    ac_guide_url: '',
    washer_guide_url: '',
    notice_template: '',
    reminder_template: ''
  });

  const [currentTab, setCurrentTab] = useState('calendar'); // calendar, add, list, stats, settings
  const [customers, setCustomers] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [mapPopupMemo, setMapPopupMemo] = useState(null);

  // 추가 기능: 프로필 닉네임, 팀원 리스트, 지출 리스트
  const [myNickname, setMyNickname] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);

  // 매출 분석용 추가 상태
  const [showTargetEdit, setShowTargetEdit] = useState(false);
  const [newTargetRevenue, setNewTargetRevenue] = useState('');
  const [showConfettiOnce, setShowConfettiOnce] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [completionTarget, setCompletionTarget] = useState(null);
  const [beforeFiles, setBeforeFiles] = useState([]);
  const [afterFiles, setAfterFiles] = useState([]);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);

  // 파트너(개별) 프로필 추가 정보 및 솔라피
  const [userProfile, setUserProfile] = useState({});
  const [solapiBalance, setSolapiBalance] = useState(null);
  const [showSolapiGuide, setShowSolapiGuide] = useState(false);
  const [editSolapiApiKey, setEditSolapiApiKey] = useState('');
  const [editSolapiApiSecret, setEditSolapiApiSecret] = useState('');
  const [editSolapiFromNumber, setEditSolapiFromNumber] = useState('');

  // 프로 샵(Pro Shop) 상태
  const [recommendedProducts, setRecommendedProducts] = useState([]);
  const [productCategory, setProductCategory] = useState('전체');
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState({ title: '', description: '', image_url: '', link_url: '', category: '에어컨', platform: '쿠팡', tag: '' });

  // PWA 업데이트 감지용
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [swRegistration, setSwRegistration] = useState(null);
  const APP_VERSION = "v1.1.0"; // 현재 버전

  // 인앱 브라우저 감지 (카카오톡 등)
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [showInAppBrowserWarning, setShowInAppBrowserWarning] = useState(false);

  // ==========================================
  // [인증 관련 (Supabase Auth)]
  // ==========================================
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('kakaotalk') || (ua.indexOf('inapp') !== -1) || ua.includes('line') || ua.includes('instagram') || ua.includes('fb') || ua.includes('naver')) {
      setIsInAppBrowser(true);
      setShowInAppBrowserWarning(true);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // 서비스 워커 등록 및 업데이트 감지
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then(reg => {
          setSwRegistration(reg);
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setShowUpdateToast(true);
              }
            });
          });
        });
    }

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

    // 내 프로필 정보
    const { data: pData } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (pData) {
      if (pData.nickname) setMyNickname(pData.nickname);
      setUserProfile(pData);
    }
  };

  const fetchSolapiBalance = async () => {
    const activeApiKey = userProfile?.solapi_api_key || businessProfile?.solapi_api_key;
    const activeApiSecret = userProfile?.solapi_api_secret || businessProfile?.solapi_api_secret;
    if (!activeApiKey || !activeApiSecret) { setSolapiBalance(null); return; }
    try {
      const date = new Date().toISOString();
      const salt = window.crypto.randomUUID().replace(/-/g, '');
      const encoder = new TextEncoder();
      const key = await window.crypto.subtle.importKey('raw', encoder.encode(activeApiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const signatureBuffer = await window.crypto.subtle.sign('HMAC', key, encoder.encode(date + salt));
      const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      const authHeader = `HMAC-SHA256 apiKey=${activeApiKey}, date=${date}, salt=${salt}, signature=${signature}`;
      const res = await fetch('https://api.solapi.com/cash/v1/balance', { headers: { 'Authorization': authHeader } });
      if (res.ok) {
        const bJson = await res.json();
        setSolapiBalance(bJson.balance || 0);
      }
    } catch (e) { }
  };

  const fetchProducts = async () => {
    const { data, error } = await supabase.from('recommended_products').select('*').order('created_at', { ascending: false });
    if (!error && data) setRecommendedProducts(data);
  };

  useEffect(() => {
    if (currentTab === 'settings') fetchSolapiBalance();
  }, [currentTab, userProfile, businessProfile]);

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
      console.error('Fetch customers error:', error);
      // 기존 데이터의 business_id 누락 고려한 폴백
      try {
        const { data: fallbackData, error: fbErr } = await supabase.from('bookings').select('*').eq('user_id', session?.user?.id).order('id', { ascending: false });
        if (!fbErr && fallbackData) setCustomers(fallbackData);
        else setCustomers([]);
      } catch (e) {
        setCustomers([]);
      }
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
      fetchProducts();

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
    if (window.confirm('정말로 이 예약을 삭제하시겠습니까? 삭제된 데이터는 복구할 수 없습니다.')) {
      const { error } = await supabase.from('bookings').delete().eq('id', id);
      if (error) {
        alert('삭제 실패: ' + error.message);
      } else {
        alert('삭제되었습니다.');
        fetchCustomers();
      }
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
  const [assignee, setAssignee] = useState(() => localStorage.getItem('default_assignee') || '');
  const [isAssigneePinned, setIsAssigneePinned] = useState(() => localStorage.getItem('default_assignee') !== null);
  const [isCompleted, setIsCompleted] = useState(false); // 완료 상태 유지용

  useEffect(() => {
    if (!assignee && myNickname) {
      setAssignee(myNickname);
    }
  }, [myNickname, assignee]);

  useEffect(() => {
    if (isAssigneePinned && assignee) {
      localStorage.setItem('default_assignee', assignee);
    } else if (!isAssigneePinned) {
      localStorage.removeItem('default_assignee');
    }
  }, [assignee, isAssigneePinned]);

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

  // 매출 실적 계산
  const revenueStats = useMemo(() => {
    const today = getTodayStr();
    const curYearMonth = today.substring(0, 7);

    // 지난달 구하기
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const prevYearMonth = d.toISOString().substring(0, 7);

    const todaySales = customers.filter(c => c.book_date === today).reduce((acc, c) => acc + (c.final_price || 0), 0);
    const monthSales = customers.filter(c => c.book_date?.startsWith(curYearMonth)).reduce((acc, c) => acc + (c.final_price || 0), 0);
    const lastMonthSales = customers.filter(c => c.book_date?.startsWith(prevYearMonth)).reduce((acc, c) => acc + (c.final_price || 0), 0);

    const growth = lastMonthSales === 0 ? 100 : Math.round(((monthSales / lastMonthSales) * 100) - 100);

    // 목표 달성률
    const target = businessProfile.monthly_target_revenue || 5000000;
    const achieveRate = Math.min(100, Math.floor((monthSales / target) * 100));

    return { todaySales, monthSales, growth, target, achieveRate };
  }, [customers, businessProfile.monthly_target_revenue]);

  useEffect(() => {
    if (revenueStats.achieveRate >= 100 && !showConfettiOnce) {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#FFD700', '#FFA500', '#FF4500']
      });
      setShowConfettiOnce(true);
      alert("축하합니다! 대표님, 이번 달 목표를 달성하셨습니다! 클린브로 화이팅! 🎉");
    }
  }, [revenueStats.achieveRate, showConfettiOnce]);

  const sendSolapiMmsLocally = async (to, text) => {
    const activeApiKey = userProfile?.solapi_api_key || businessProfile?.solapi_api_key;
    const activeApiSecret = userProfile?.solapi_api_secret || businessProfile?.solapi_api_secret;
    const activeFromNumber = userProfile?.solapi_from_number || businessProfile?.solapi_from_number;
    if (!activeApiKey || !activeApiSecret || !activeFromNumber) throw new Error("솔라피 연동 설정이 필요합니다.");
    const date = new Date().toISOString();
    const salt = window.crypto.randomUUID().replace(/-/g, '');
    const encoder = new TextEncoder();
    const key = await window.crypto.subtle.importKey('raw', encoder.encode(activeApiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await window.crypto.subtle.sign('HMAC', key, encoder.encode(date + salt));
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: { 'Authorization': `HMAC-SHA256 apiKey=${activeApiKey}, date=${date}, salt=${salt}, signature=${signature}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ to: to.replace(/[^0-9]/g, ''), from: activeFromNumber.replace(/[^0-9]/g, ''), text: text }] })
    });
    if (!res.ok) throw new Error("문자 발송 에러: " + res.statusText);
  };

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
      applied_tax_type: businessProfile?.taxpayer_type || '간이과세자',
    };

    let error;
    if (editingId) {
      const { error: updErr, data } = await supabase.from('bookings').update(entry).eq('id', editingId).select();
      error = updErr;
      if (!error) alert('예약이 수정되었습니다.');
    } else {
      const { error: insErr, data } = await supabase.from('bookings').insert([entry]).select();
      error = insErr;
      if (!error && data && data[0]) {
        try {
          const confirmedTpl = businessProfile.confirmed_template || `[예약 확정] [일시]에 방문 예정입니다. - 클린브로 ([파트너전화번호])`;
          const timeVal = entry.book_time_type === '직접입력' ? entry.book_time_custom : entry.book_time_type;
          const dateTimeStr = `${entry.book_date} ${timeVal}`;
          const senderPhone = userProfile?.solapi_from_number || userProfile?.sender_number || businessProfile?.solapi_from_number || businessProfile?.phone || '';

          if (senderPhone && (userProfile?.solapi_api_key || businessProfile?.solapi_api_key) && entry.phone) {
            const msg = confirmedTpl
              .replace(/\[고객명\]/g, entry.customer_name || '고객')
              .replace(/\[일시\]/g, dateTimeStr)
              .replace(/\[시간\]/g, timeVal || '')
              .replace(/\[파트너전화번호\]/g, senderPhone);
            await sendSolapiMmsLocally(entry.phone, msg);
            await supabase.from('bookings').update({ sms_sent_initial: true }).eq('id', data[0].id);
          }
        } catch (err) {
          console.error('예약 확정 자동 문자 발송 실패:', err);
        }
      }
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
  const [editTaxpayerType, setEditTaxpayerType] = useState('간이과세자'); // 과세자 유형
  const [editDefaultMessage, setEditDefaultMessage] = useState('');
  const [editNoticeTemplate, setEditNoticeTemplate] = useState('');
  const [editReminderTemplate, setEditReminderTemplate] = useState('');
  const [editConfirmedTemplate, setEditConfirmedTemplate] = useState('');
  const [editMorningReminderTemplate, setEditMorningReminderTemplate] = useState('');
  const [editAcGuideFile, setEditAcGuideFile] = useState(null);
  const [editWasherGuideFile, setEditWasherGuideFile] = useState(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // 일괄 변경 State
  const [bulkStartDate, setBulkStartDate] = useState(getTodayStr());
  const [bulkEndDate, setBulkEndDate] = useState(getTodayStr());
  const [bulkTaxType, setBulkTaxType] = useState('일반과세자');
  const [isBulking, setIsBulking] = useState(false);

  useEffect(() => {
    if (currentTab === 'settings') {
      setEditCompanyName(businessProfile.company_name || '');
      setEditBusinessPhone(businessProfile.phone || '');
      setEditLogoFile(null);
      setEditNickname(myNickname || '');
      setEditTaxpayerType(businessProfile.taxpayer_type || '간이과세자');
      setEditDefaultMessage(businessProfile.default_completion_message || `[클린브로] 청소 작업 완료 안내\n안녕하세요, 고객님! {customer_name}님 {memo} 작업이 완료되었습니다.\n\n📸 작업 사진 확인하기:\n{after_url}\n\n만족하셨다면 리뷰 부탁드립니다!\n[리뷰링크]`);
      setEditNoticeTemplate(businessProfile.notice_template || `[안내] 오늘 방문 예정입니다. 시간 맞춰 뵙겠습니다.\n- 클린브로 ([시간])`);
      setEditReminderTemplate(businessProfile.reminder_template || `[알림] [고객명]님, 곧 도착 예정입니다. 잠시만 기다려주세요!`);
      setEditConfirmedTemplate(businessProfile.confirmed_template || `[예약 확정] [일시]에 예약이 완료되었습니다. - 클린브로 ([파트너전화번호])`);
      setEditMorningReminderTemplate(businessProfile.morning_reminder_template || `[알림] 오늘 [시간]에 방문 예정입니다. 뵙겠습니다! - 클린브로 ([파트너전화번호])`);
      setEditSolapiApiKey(userProfile?.solapi_api_key || businessProfile?.solapi_api_key || '');
      setEditSolapiApiSecret(userProfile?.solapi_api_secret || businessProfile?.solapi_api_secret || '');
      setEditSolapiFromNumber(userProfile?.solapi_from_number || businessProfile?.solapi_from_number || '');
    }
  }, [currentTab, businessProfile, myNickname, userProfile]);

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
      taxpayer_type: editTaxpayerType,
      default_completion_message: editDefaultMessage,
      notice_template: editNoticeTemplate,
      reminder_template: editReminderTemplate,
      confirmed_template: editConfirmedTemplate,
      morning_reminder_template: editMorningReminderTemplate,
    };

    // 가이드 이미지 업로드 (에어컨)
    if (editAcGuideFile) {
      const fileExt = editAcGuideFile.name.split('.').pop();
      const fileName = `${myBusinessId}_ac_guide_${Date.now()}.${fileExt}`;
      const { error: upErr } = await supabase.storage.from('logos').upload(fileName, editAcGuideFile, { upsert: true });
      if (!upErr) {
        const { data } = supabase.storage.from('logos').getPublicUrl(fileName);
        upsertData.ac_guide_url = data.publicUrl;
      }
    } else {
      upsertData.ac_guide_url = businessProfile.ac_guide_url;
    }

    // 가이드 이미지 업로드 (세탁기)
    if (editWasherGuideFile) {
      const fileExt = editWasherGuideFile.name.split('.').pop();
      const fileName = `${myBusinessId}_washer_guide_${Date.now()}.${fileExt}`;
      const { error: upErr } = await supabase.storage.from('logos').upload(fileName, editWasherGuideFile, { upsert: true });
      if (!upErr) {
        const { data } = supabase.storage.from('logos').getPublicUrl(fileName);
        upsertData.washer_guide_url = data.publicUrl;
      }
    } else {
      upsertData.washer_guide_url = businessProfile.washer_guide_url;
    }

    const { error: bError } = await supabase.from('businesses').upsert([upsertData]);

    // 유저 프로필(닉네임) 저장 (현재 로그인된 user.id 기준)
    const { error: pError } = await supabase.from('profiles').upsert([{
      id: session.user.id,
      business_id: myBusinessId,
      nickname: editNickname,
      solapi_api_key: editSolapiApiKey,
      solapi_api_secret: editSolapiApiSecret,
      solapi_from_number: editSolapiFromNumber
    }]);

    if (bError || pError) {
      alert('프로필 저장 실패: ' + (bError?.message || pError?.message));
    } else {
      setBusinessProfile(upsertData);
      setMyNickname(editNickname);
      setUserProfile(prev => ({ ...prev, nickname: editNickname, solapi_api_key: editSolapiApiKey, solapi_api_secret: editSolapiApiSecret, solapi_from_number: editSolapiFromNumber }));
      alert('업체 정보 및 내 닉네임이 성공적으로 업데이트되었습니다.');
      fetchTeamMembers(); // 업데이트 후 팀원 목록 즉시 갱신
      fetchSolapiBalance(); // 설정 저장 직후 솔라피 잔액 재조회
    }
    setIsSavingSettings(false);
  };

  const handleBulkTaxUpdate = async () => {
    if (!window.confirm(`${bulkStartDate} ~ ${bulkEndDate} 기간의 모든 데이터 세무 기준을 '${bulkTaxType}'(으)로 일괄 변경할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setIsBulking(true);

    const { error: err1 } = await supabase.from('bookings').update({ applied_tax_type: bulkTaxType })
      .gte('book_date', bulkStartDate).lte('book_date', bulkEndDate).eq('business_id', myBusinessId);

    const { error: err2 } = await supabase.from('expenses').update({ applied_tax_type: bulkTaxType })
      .gte('date_created', bulkStartDate).lte('date_created', bulkEndDate).eq('business_id', myBusinessId);

    if (err1 || err2) {
      alert('일괄 업데이트 중 오류가 발생했습니다.');
    } else {
      alert('세무 기준 일괄 업데이트가 성공적으로 완료되었습니다.');
      fetchCustomers();
      fetchExpenses();
    }
    setIsBulking(false);
  };

  // ==========================================
  // [탭: 지출 관리 (Expenses)]
  // ==========================================
  const [exAmount, setExAmount] = useState('');
  const [exCategory, setExCategory] = useState('자재/장비');
  const [exMemo, setExMemo] = useState('');
  const [exReceiptFile, setExReceiptFile] = useState(null);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState(null);

  const handleSaveExpense = async (e) => {
    e.preventDefault();
    if (!exAmount) return alert('지출 금액을 입력해 주세요.');
    setIsSavingExpense(true);

    let receiptUrl = null;
    if (editingExpenseId) {
      const existing = expenses.find(exp => exp.id === editingExpenseId);
      receiptUrl = existing?.receipt_url;
    }

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

    const payload = {
      user_id: session.user.id,
      business_id: myBusinessId,
      amount: parseInt(exAmount.toString().replace(/[^0-9]/g, '') || 0),
      category: exCategory,
      memo: exMemo,
      receipt_url: receiptUrl,
    };

    let error;
    if (editingExpenseId) {
      const { error: updErr } = await supabase.from('expenses').update(payload).eq('id', editingExpenseId);
      error = updErr;
    } else {
      payload.date_created = getTodayStr();
      payload.applied_tax_type = businessProfile?.taxpayer_type || '간이과세자';
      const { error: insErr } = await supabase.from('expenses').insert([payload]);
      error = insErr;
    }

    if (error) {
      alert('지출 저장 실패: ' + error.message);
    } else {
      alert(editingExpenseId ? '지출이 수정되었습니다.' : '지출이 성공적으로 등록되었습니다!');
      setExAmount(''); setExMemo(''); setExReceiptFile(null);
      setEditingExpenseId(null);
      fetchExpenses();
    }
    setIsSavingExpense(false);
  };

  const handleEditExpense = (exp) => {
    setEditingExpenseId(exp.id);
    setExAmount(fmtNum(exp.amount.toString()));
    setExCategory(exp.category);
    setExMemo(exp.memo || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm("이 지출 내역을 정말 삭제할까요?")) return;
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) alert('삭제 실패: ' + error.message);
    else {
      alert('삭제되었습니다.');
      fetchExpenses();
    }
  };

  // ==========================================
  // [세무 대시보드 계산]
  // ==========================================
  const [taxYear, setTaxYear] = useState(() => new Date().getFullYear());
  const [taxMonth, setTaxMonth] = useState(() => new Date().getMonth() + 1);

  const calcTax = () => {
    const targetMonthStr = `${taxYear}-${String(taxMonth).padStart(2, '0')}`;

    let totalTaxableSales = 0;
    let totalGrossSales = 0;

    let totalSalesTax = 0;
    let totalPurchaseTax = 0;
    let totalCreditCardDeduction = 0;

    customers.filter(c => c.book_date?.startsWith(targetMonthStr)).forEach(c => {
      const isRecognizedSale = c.payment_method === '카드' || (c.payment_method === '현금' && (c.has_cash_receipt || c.has_tax_invoice));
      const taxType = c.applied_tax_type || '간이과세자';

      totalGrossSales += c.final_price;

      if (taxType === '일반과세자') {
        if (isRecognizedSale) {
          totalTaxableSales += c.final_price;
          totalSalesTax += Math.floor(c.final_price * 0.1);
          totalCreditCardDeduction += Math.floor(c.final_price * 0.013);
        }
      } else {
        totalSalesTax += Math.floor(c.final_price * 0.3 * 0.1);
        if (isRecognizedSale) {
          totalTaxableSales += c.final_price;
          totalCreditCardDeduction += Math.floor(c.final_price * 0.013);
        }
      }
    });

    let thisMonthExpenses = 0;
    expenses.filter(e => e.date_created?.startsWith(targetMonthStr)).forEach(e => {
      thisMonthExpenses += e.amount;
      const taxType = e.applied_tax_type || '간이과세자';

      if (taxType === '일반과세자') {
        totalPurchaseTax += Math.floor(e.amount * 0.1);
      } else {
        totalPurchaseTax += Math.floor(e.amount * 0.005);
      }
    });

    const finalTax = Math.max(0, totalSalesTax - totalPurchaseTax - totalCreditCardDeduction);

    return {
      taxableSales: totalTaxableSales,
      salesTax: totalSalesTax,
      thisMonthExpenses,
      purchaseTax: totalPurchaseTax,
      creditCardDeduction: totalCreditCardDeduction,
      finalTax
    };
  };

  const exportToCSV = () => {
    const yearStr = `${taxYear}-`;
    const yrBookings = customers.filter(c => c.book_date?.startsWith(yearStr));
    const yrExpenses = expenses.filter(e => e.date_created?.startsWith(yearStr));

    let csv = '\uFEFF';
    csv += '=== 매출 내역 ===\n';
    csv += '날짜,고객/내용,카테고리,상품,카드 매출액,현금영수증 매출액,기타(무증빙) 매출액,세금적용기준\n';
    yrBookings.forEach(c => {
      let cardSales = 0; let cashReceiptSales = 0; let otherSales = 0;
      if (c.payment_method === '카드') cardSales = c.final_price;
      else if (c.has_cash_receipt || c.has_tax_invoice) cashReceiptSales = c.final_price;
      else otherSales = c.final_price;

      const safeMemo = (c.customer_name || c.memo || '').replace(/"/g, '""');
      csv += `${c.book_date},"${safeMemo}","${c.category}","${c.product}",${cardSales},${cashReceiptSales},${otherSales},${c.applied_tax_type || '간이과세자'}\n`;
    });

    csv += '\n=== 지출 내역 ===\n';
    csv += '날짜,카테고리,내용,금액,영수증첨부,세금적용기준\n';
    yrExpenses.forEach(e => {
      const hasReceipt = e.receipt_url ? 'O' : 'X';
      const safeMemo = (e.memo || '').replace(/"/g, '""');
      csv += `${e.date_created},${e.category},"${safeMemo}",${e.amount},${hasReceipt},${e.applied_tax_type || '간이과세자'}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `클린브로_${taxYear}년도_세무자료.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      const subject = encodeURIComponent(`[클린브로] ${taxYear}년도 세무 신고 자료`);
      const body = encodeURIComponent(`세무사님,\n\n${taxYear}년도 클린브로 매출 및 지출 내역 자료를 보내드립니다.\n\n* 방금 기기에 다운로드된 [클린브로_${taxYear}년도_세무자료.csv] 파일을 첨부하여 보내주세요.\n\n감사합니다.`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    }, 500);
  };

  const getAiTaxAdvice = () => {
    const yearStr = `${taxYear}-`;
    const yrSales = customers.filter(c => c.book_date?.startsWith(yearStr)).reduce((sum, c) => sum + c.final_price, 0);

    const targetMonthStr = `${taxYear}-${String(taxMonth).padStart(2, '0')}`;
    const moExpenses = expenses.filter(e => e.date_created?.startsWith(targetMonthStr));
    const totalMoExp = moExpenses.reduce((sum, e) => sum + e.amount, 0);
    const expWithReceipt = moExpenses.filter(e => e.receipt_url).reduce((sum, e) => sum + e.amount, 0);
    const receiptRatio = totalMoExp > 0 ? expWithReceipt / totalMoExp : 1;

    let genSalesTax = 0; let genPurchaseTax = 0; let genCardDeduct = 0;
    customers.filter(c => c.book_date?.startsWith(targetMonthStr)).forEach(c => {
      const isRecognized = c.payment_method === '카드' || (c.payment_method === '현금' && (c.has_cash_receipt || c.has_tax_invoice));
      if (isRecognized) {
        genSalesTax += Math.floor(c.final_price * 0.1);
        genCardDeduct += Math.floor(c.final_price * 0.013);
      }
    });
    expenses.filter(e => e.date_created?.startsWith(targetMonthStr)).forEach(e => {
      genPurchaseTax += Math.floor(e.amount * 0.1);
    });
    const genFinalTax = Math.max(0, genSalesTax - genPurchaseTax - genCardDeduct);

    return { yrSales, receiptRatio, totalMoExp, simulatedGenTax: genFinalTax };
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

  const handleSendSms = (c, type = 'notice') => {
    let template = type === 'notice'
      ? (businessProfile.notice_template || `[안내] 오늘 방문 예정입니다. 시간 맞춰 뵙겠습니다.\n- 클린브로 ([시간])`)
      : (businessProfile.reminder_template || `[알림] [고객명]님, 곧 도착 예정입니다. 잠시만 기다려주세요!`);

    const timeValue = c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type;
    const msg = template
      .replace(/\[고객명\]/g, c.customer_name || '고객')
      .replace(/\[시간\]/g, timeValue);

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
              <button onClick={(e) => { e.stopPropagation(); handleSendSms(c, 'notice'); }} className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border cursor-pointer active:scale-95 transition-transform ${c.sms_sent_initial ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-300 hover:bg-slate-100 shadow-sm'}`}>
                <span className="material-symbols-outlined text-[12px]">sms</span> {c.sms_sent_initial ? '안내 재발송' : '안내 문자(Notice)'}
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleSendSms(c, 'reminder'); }} className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border cursor-pointer active:scale-95 transition-transform ${c.sms_sent_reminder ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-300 hover:bg-slate-100 shadow-sm'}`}>
                <span className="material-symbols-outlined text-[12px]">alarm</span> {c.sms_sent_reminder ? '알림 재발송' : '알림 문자(Reminder)'}
              </button>
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
          <button onClick={() => handleDelete(c.id)} className="text-xs px-3 py-1.5 rounded-lg border font-bold transition-colors bg-red-50 text-red-600 border-red-200 hover:bg-red-100 shadow-sm">
            🗑️ 삭제하기
          </button>
          <button onClick={() => handleEdit(c)} className="text-xs px-3 py-1.5 rounded-lg border font-bold transition-colors bg-white text-slate-500 border-slate-300 hover:bg-slate-50 shadow-sm">
            ✏️ 수정하기
          </button>
          <button onClick={() => {
            if (c.is_completed) {
              toggleCompletion(c);
            } else {
              setCompletionTarget(c);
              setShowCompletionModal(true);
            }
          }} className={`text-xs px-3 py-1.5 rounded-lg border font-bold transition-colors shadow-sm ${c.is_completed ? 'bg-slate-50 text-slate-500 border-slate-300 hover:bg-slate-100' : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'}`}>
            {c.is_completed ? '작업 취소 (미완료로 변경)' : '✨ 작업 완료 체크하기'}
          </button>
        </div>
      </div>
    );
  };

  // --- 목표 매출 수정 처리 ---
  const handleSaveTarget = async () => {
    const targetVal = parseInt(newTargetRevenue.replace(/[^0-9]/g, '') || 0);
    const { error } = await supabase.from('businesses').update({ monthly_target_revenue: targetVal }).eq('id', myBusinessId);
    if (!error) {
      setBusinessProfile({ ...businessProfile, monthly_target_revenue: targetVal });
      setShowTargetEdit(false);
      alert('목표 매출이 수정되었습니다.');
    } else alert('수정 실패: ' + error.message);
  };

  // --- 이미지 워터마크 & 압축 로직 ---
  const processImage = async (file) => {
    // 1. 이미지 압축 (최대 500KB, 가로세로 1024px)
    const options = { maxSizeMB: 0.5, maxWidthOrHeight: 1024, useWebWorker: true };
    const compressedFile = await imageCompression(file, options);

    // 2. 워터마크 합성
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(compressedFile);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          // 워터마크 스타일
          const fontSize = Math.max(img.width * 0.03, 20);
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.textAlign = 'right';

          const text1 = `Clean Bro | ${businessProfile.company_name}`;
          const text2 = getTodayStr();
          ctx.fillText(text1, canvas.width - 20, canvas.height - 45);
          ctx.fillText(text2, canvas.width - 20, canvas.height - 15);

          canvas.toBlob((blob) => {
            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.85);
        };
      };
    });
  };

  // --- 작업 완료 & 사진 업로드 & MMS 발송 ---
  const handleFinalComplete = async () => {
    if (beforeFiles.length === 0 || afterFiles.length === 0) return alert('전/후 사진을 최소 1장씩은 등록해주세요.');
    setIsUploadingPhotos(true);

    try {
      const uploadResults = { before: [], after: [] };

      const doUpload = async (files, type) => {
        for (const file of files) {
          const processed = await processImage(file);
          const fileName = `${myBusinessId}/${completionTarget.id}/${type}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;
          const { error: upErr } = await supabase.storage.from('receipts').upload(fileName, processed);
          if (upErr) throw upErr;
          const { data } = supabase.storage.from('receipts').getPublicUrl(fileName);
          uploadResults[type].push(data.publicUrl);
        }
      };

      await doUpload(beforeFiles, 'before');
      await doUpload(afterFiles, 'after');

      // DB 업데이트
      const { error: dbErr } = await supabase.from('bookings').update({
        is_completed: true,
        photo_before: uploadResults.before,
        photo_after: uploadResults.after
      }).eq('id', completionTarget.id);

      if (dbErr) throw dbErr;

      // MMS 발송 시트 제작 (실제 전송은 여기서 Edge Function 호출하거나 window.open 등으로 유도)
      // 여기서는 UI 로직에 따라 문자 발송 안내를 띄움
      // MMS 발송 시트 제작
      let mmsText = businessProfile.default_completion_message || `[클린브로] 청소 작업 완료 안내\n안녕하세요, 고객님! {customer_name}님 {memo} 작업이 완료되었습니다.\n\n📸 작업 사진 확인하기:\n{after_url}\n\n만족하셨다면 리뷰 부탁드립니다!\n[리뷰링크]`;

      mmsText = mmsText
        .replace(/{customer_name}/g, completionTarget.customer_name || '고객')
        .replace(/{memo}/g, completionTarget.memo || '')
        .replace(/{after_url}/g, uploadResults.after[0] || '');

      // 가이드 이미지 포함 로직
      if (completionTarget.category === '에어컨' && businessProfile.ac_guide_url) {
        mmsText += `\n\n❄️ 에어컨 사후관리 가이드:\n${businessProfile.ac_guide_url}`;
      } else if (completionTarget.category === '세탁기' && businessProfile.washer_guide_url) {
        mmsText += `\n\n🧺 세탁기 사후관리 가이드:\n${businessProfile.washer_guide_url}`;
      }

      try {
        await sendSolapiMmsLocally(completionTarget.phone, mmsText);
        alert('작업이 완벽하게 완료되었으며 고객님께 알림 문자가 바로 발송되었습니다.');
      } catch (err) {
        console.error(err);
        alert('작업완료/사진저장은 성공! 하지만 자동 문자가 실패했습니다.\n사유: ' + err.message + '\n메시지 앱을 대신 엽니다.');
        const smsUrl = `sms:${completionTarget.phone}?body=${encodeURIComponent(mmsText)}`;
        window.open(smsUrl);
      }

      setShowCompletionModal(false);
      setBeforeFiles([]); setAfterFiles([]);
      fetchCustomers();
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    } finally {
      setIsUploadingPhotos(false);
    }
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (editingProduct.id) {
      await supabase.from('recommended_products').update(editingProduct).eq('id', editingProduct.id);
    } else {
      await supabase.from('recommended_products').insert([editingProduct]);
    }
    setShowProductModal(false);
    fetchProducts();
  };

  const handleDeleteProduct = async (id) => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      await supabase.from('recommended_products').delete().eq('id', id);
      fetchProducts();
    }
  };

  // --- 로그인 처리 안되었을 시 화면 출력 ---
  if (!session) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-indigo-900 via-blue-900 to-purple-900">
        <div className="relative z-10 bg-white w-full max-w-sm px-8 pt-8 pb-10 rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] border border-white/20 backdrop-blur-sm">
          <div className="text-center mb-8 pt-4">
            {/* 3D Water Drop Icon */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 relative">
                <svg viewBox="0 0 24 24" className="w-full h-full drop-shadow-[0_8px_16px_rgba(37,99,235,0.4)]">
                  <defs>
                    <linearGradient id="dropGradient" x1="10%" y1="0%" x2="90%" y2="100%">
                      <stop offset="0%" stopColor="#93C5FD" />
                      <stop offset="40%" stopColor="#3B82F6" />
                      <stop offset="100%" stopColor="#1E40AF" />
                    </linearGradient>
                    <linearGradient id="highlight" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Main drop base */}
                  <path
                    d="M12 21.5C7.30558 21.5 3.5 17.6944 3.5 13C3.5 10.3204 5.37894 6.84518 11.2335 2.37865C11.666 2.0487 12.334 2.0487 12.7665 2.37865C18.6211 6.84518 20.5 10.3204 20.5 13C20.5 17.6944 16.6944 21.5 12 21.5Z"
                    fill="url(#dropGradient)"
                  />
                  {/* Highlight inner glow */}
                  <path
                    d="M11.5 4C9 7 7 10 6 12.5C5.8 13.5 6 14.5 6.5 15.5C5.5 14.5 5 13 5.5 11.5C6.5 8.5 8.5 6 11.5 4Z"
                    fill="url(#highlight)"
                  />
                  {/* Reflection dot */}
                  <ellipse cx="14.5" cy="16.5" rx="1.5" ry="1" fill="#FFFFFF" opacity="0.4" transform="rotate(-30, 14.5, 16.5)" />
                </svg>
              </div>
            </div>

            {/* Logo Text aligned with the card */}
            <h2 className="text-[13px] font-black text-blue-900 tracking-[0.1em] uppercase mb-8">
              Cleaning Service All-in-One App
            </h2>

            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight drop-shadow-sm">
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
  const userEmail = session?.user?.email || 'user@cleanbro.com';
  const userName = userEmail.split('@')[0];
  const isCeo = userName.includes('admin') || userName.includes('ceo') || userName.includes('master');
  const roleName = isCeo ? '대표님' : '파트너님';

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-900 pb-24 text-slate-900 dark:text-slate-100 font-display">

      {/* 솔라피 잔액 부족 경고 배너 */}
      {solapiBalance !== null && solapiBalance < 2000 && (
        <div className="bg-red-500 text-white px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 shadow-sm animate-pulse z-40 relative">
          <span className="material-symbols-outlined text-[16px]">warning</span>
          ⚠️ 솔라피 잔액이 부족합니다. 문자가 발송되지 않을 수 있으니 충전해 주세요!
        </div>
      )}

      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md px-5 py-4 flex justify-between items-center">
        <div className="flex gap-2 items-center">
          {businessProfile.logo_url ? (
            <img src={businessProfile.logo_url} alt="Logo" className="w-8 h-8 object-contain rounded-full border border-slate-200 bg-white shadow-sm" />
          ) : (
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-black text-sm shadow-sm">
              {businessProfile?.company_name?.substring(0, 1) || 'B'}
            </div>
          )}
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight flex items-center gap-1">
            {businessProfile?.company_name || '클린브로'}
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
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleSendSms(c, 'notice')} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg border border-blue-200 active:scale-95">
                        <span className="material-symbols-outlined text-[12px]">notifications</span> 안내
                      </button>
                      <button onClick={() => handleSendSms(c, 'reminder')} className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-200 active:scale-95">
                        <span className="material-symbols-outlined text-[12px]">alarm</span> 알림
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 대시보드 */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-[0_10px_30px_-5px_rgba(0,0,0,0.05)] border-0">
            <div className="grid grid-cols-[1fr,1px,1.2fr] items-center gap-4">
              <div className="cursor-pointer transition-transform active:scale-95" onClick={() => setCurrentTab('stats')}>
                <p className="text-[11px] font-bold text-slate-400 mb-1 leading-none">오늘의 합계 매출</p>
                <div className="text-2xl font-black text-slate-800 dark:text-white flex items-baseline truncate">
                  {fmtNum(revenueStats.todaySales)}<span className="text-[13px] text-slate-400 font-bold ml-0.5">원</span>
                </div>
              </div>

              <div className="h-10 w-[1px] bg-slate-100 dark:bg-slate-700"></div>

              <div className="cursor-pointer transition-transform active:scale-95" onClick={() => setCurrentTab('stats')}>
                <p className="text-[11px] font-bold text-slate-400 mb-1 leading-none">이번 달 총 매출</p>
                <div className="flex flex-col">
                  <div className="text-2xl font-black text-primary flex items-baseline truncate">
                    {fmtNum(revenueStats.monthSales)}<span className="text-[13px] text-slate-400 font-bold ml-0.5">원</span>
                  </div>
                  <div className={`text-[10px] font-bold mt-0.5 flex items-center gap-0.5 ${revenueStats.growth >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                    {revenueStats.growth >= 0 ? '▲' : '▼'} {Math.abs(revenueStats.growth)}% <span className="text-slate-400 font-medium">전월대비</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 목표 달성 게이지 */}
            <div className="mt-6 pt-5 border-t border-slate-50 dark:border-slate-700">
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-bold text-slate-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-amber-500">military_tech</span>
                  목표 달성률 <span className="text-slate-900 dark:text-white">{revenueStats.achieveRate}%</span>
                </p>
                <button onClick={() => { setNewTargetRevenue(revenueStats.target.toString()); setShowTargetEdit(true); }} className="p-1 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors text-slate-400 flex items-center">
                  <span className="material-symbols-outlined text-[16px]">settings</span>
                </button>
              </div>
              <div className="w-full h-3 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden flex p-0.5 border border-slate-50">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-out shadow-sm relative ${revenueStats.achieveRate < 50 ? 'bg-orange-500' :
                    revenueStats.achieveRate < 80 ? 'bg-yellow-400' :
                      revenueStats.achieveRate < 100 ? 'bg-green-500' :
                        'bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 animate-pulse'
                    }`}
                  style={{ width: `${revenueStats.achieveRate}%` }}
                >
                  {revenueStats.achieveRate >= 100 && <span className="absolute inset-0 bg-white/30 animate-pulse"></span>}
                </div>
              </div>
              <div className="flex justify-between mt-2 px-0.5">
                <span className="text-[10px] text-slate-400 font-bold">이번 달 목표액</span>
                <span className="text-[11px] text-slate-600 font-black">{fmtNum(revenueStats.target)}원</span>
              </div>
            </div>
          </div>

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
                  <div className="flex justify-between items-end mb-1">
                    <label className="block text-xs font-semibold text-slate-500">작업 담당자 지정</label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={isAssigneePinned} onChange={(e) => setIsAssigneePinned(e.target.checked)} className="w-3.5 h-3.5 text-primary rounded border-slate-300 focus:ring-primary" />
                      <span className="text-[10px] font-bold text-slate-600">🌟 고정</span>
                    </label>
                  </div>
                  <select
                    value={assignee}
                    onChange={e => setAssignee(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 bg-white"
                  >
                    {[...new Set([myNickname, ...teamMembers])].filter(Boolean).map(nickname => (
                      <option key={nickname} value={nickname}>{nickname}</option>
                    ))}
                    <option value="파트너">파트너 (닉네임 미지정)</option>
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
              <label className="block text-xs font-bold text-slate-500 mb-1">과세자 유형</label>
              <select value={editTaxpayerType} onChange={e => setEditTaxpayerType(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-primary">
                <option value="간이과세자">간이과세자</option>
                <option value="일반과세자">일반과세자</option>
              </select>
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

            <button disabled={isSavingSettings} type="submit" className="w-full py-4 bg-primary text-white text-lg font-black rounded-xl shadow-lg shadow-primary/20 active:scale-95 transition-transform flex justify-center items-center gap-2">
              <span className="material-symbols-outlined">{isSavingSettings ? 'sync' : 'save'}</span>
              {isSavingSettings ? '업데이트 중...' : '프로필 정보 업데이트'}
            </button>

            {/* PWA 버전 정보 및 업데이트 체크 */}
            <div className="pt-4 border-t border-slate-100 flex flex-col items-center gap-2">
              <p className="text-[10px] text-slate-400 font-bold">App Version: {APP_VERSION}</p>
              <button
                type="button"
                onClick={() => {
                  if (swRegistration) {
                    swRegistration.update().then(() => alert('업데이트 확인을 완료했습니다.'));
                  } else {
                    alert('서비스 워커가 활성화되지 않았습니다.');
                  }
                }}
                className="text-[11px] text-slate-500 hover:text-primary underline font-bold"
              >
                새로운 업데이트 확인하기
              </button>
            </div>
          </form>

          {/* 작업 완료 자동 메시지 관리 섹션 */}
          <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-6">
            <h3 className="text-lg font-black flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">chat</span> 작업 완료 자동 메시지 관리
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">고객 전송 메시지 템플릿</label>
              <textarea
                value={editDefaultMessage}
                onChange={e => setEditDefaultMessage(e.target.value)}
                className="w-full h-40 p-4 text-sm bg-slate-50 dark:bg-slate-900 border rounded-xl focus:ring-2 focus:ring-primary outline-none"
                placeholder="메시지 내용을 입력하세요. {customer_name}, {memo}, {after_url} 변수를 사용할 수 있습니다."
              />
              <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                * 사용 가능 치환자 : <span className="font-bold text-primary">{`{customer_name}`}</span>(고객 이름), <span className="font-bold text-primary">{`{memo}`}</span>(작업 내용), <span className="font-bold text-primary">{`{after_url}`}</span>(작업 사진 링크)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">❄️ 에어컨 관리 가이드</label>
                {businessProfile.ac_guide_url && <img src={businessProfile.ac_guide_url} className="w-full h-20 object-cover rounded-lg mb-2 border" />}
                <input type="file" accept="image/*" onChange={e => setEditAcGuideFile(e.target.files[0])} className="w-full text-[9px]" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5">🧺 세탁기 관리 가이드</label>
                {businessProfile.washer_guide_url && <img src={businessProfile.washer_guide_url} className="w-full h-20 object-cover rounded-lg mb-2 border" />}
                <input type="file" accept="image/*" onChange={e => setEditWasherGuideFile(e.target.files[0])} className="w-full text-[9px]" />
              </div>
            </div>

            <button onClick={handleSaveProfile} disabled={isSavingSettings} className="w-full py-4 bg-slate-800 text-white font-bold rounded-[1.2rem] shadow-lg active:scale-95 transition-all flex justify-center items-center gap-2">
              <span className="material-symbols-outlined">save</span>
              {isSavingSettings ? '저장 중...' : '메시지 및 가이드 설정 저장'}
            </button>

            {/* 문자 미리보기 */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
              <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">preview</span> 고객 수신 문자 미리보기
              </p>
              <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-[2rem] border border-slate-200 dark:border-slate-700 max-w-[280px] mx-auto shadow-inner relative">
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-300 rounded-full"></div>
                <div className="mt-4 break-words whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700 dark:text-slate-300 font-display">
                  {editDefaultMessage
                    .replace(/{customer_name}/g, '홍길동')
                    .replace(/{memo}/g, '삼성 무풍 벽걸이 에어컨')
                    .replace(/{after_url}/g, 'https://supabase-url.com/after_photo.jpg')
                  }
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 text-[9px] text-blue-500 font-bold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">info</span>
                  가이드 이미지는 하단에 링크형태로 자동 첨부됩니다.
                </div>
              </div>
            </div>
          </div>

          {/* 솔라피 & 문자 메시지 템플릿 관리 섹션 */}
          <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-6">
            <h3 className="text-lg font-black flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">sms</span> 템플릿 & 발송 설정
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">방문 안내 문자 (Notice)</label>
                <textarea
                  value={editNoticeTemplate}
                  onChange={e => setEditNoticeTemplate(e.target.value)}
                  className="w-full h-20 p-4 text-sm bg-slate-50 dark:bg-slate-900 border rounded-xl focus:ring-2 focus:ring-primary outline-none"
                  placeholder="예: [안내] 오늘 방문 예정입니다. 시간 맞춰 뵙겠습니다. - 클린브로 ([시간])"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">방문 알림 문자 (Reminder)</label>
                <textarea
                  value={editReminderTemplate}
                  onChange={e => setEditReminderTemplate(e.target.value)}
                  className="w-full h-20 p-4 text-sm bg-slate-50 dark:bg-slate-900 border rounded-xl focus:ring-2 focus:ring-primary outline-none"
                  placeholder="예: [알림] [고객명]님, 곧 도착 예정입니다. 잠시만 기다려주세요!"
                />
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                <label className="block text-xs font-bold text-slate-500 mb-1 text-primary">예약 확정 자동 문자 (등록 시 바로 발송)</label>
                <textarea
                  value={editConfirmedTemplate}
                  onChange={e => setEditConfirmedTemplate(e.target.value)}
                  className="w-full h-20 p-4 text-sm bg-blue-50/50 dark:bg-slate-900 border border-blue-200/50 rounded-xl focus:ring-2 focus:ring-primary outline-none"
                  placeholder="예: [예약 확정] [일시]에 예약이 완료되었습니다. - 클린브로 ([파트너전화번호])"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 text-primary">당일 아침 8시 자동 알림 (솔라피 연동 필요)</label>
                <textarea
                  value={editMorningReminderTemplate}
                  onChange={e => setEditMorningReminderTemplate(e.target.value)}
                  className="w-full h-20 p-4 text-sm bg-blue-50/50 dark:bg-slate-900 border border-blue-200/50 rounded-xl focus:ring-2 focus:ring-primary outline-none"
                  placeholder="예: [알림] 오늘 [시간]에 방문 예정입니다. 뵙겠습니다! - 클린브로 ([파트너전화번호])"
                />
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed bg-slate-50 p-2 rounded-lg">
                * 사용 가능 치환자 : <span className="font-bold text-primary">[고객명]</span>, <span className="font-bold text-primary">[일시]</span>, <span className="font-bold text-primary">[시간]</span>, <span className="font-bold text-primary">[파트너전화번호]</span>
              </p>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
              <div className="flex items-end justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-primary">send_to_mobile</span>
                  나의 문자 발송 (솔라피)
                </h4>
                {solapiBalance !== null && (
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                    잔액: <span className={solapiBalance < 2000 ? "text-red-500" : "text-blue-500"}>{fmtNum(solapiBalance)}원</span>
                  </span>
                )}
              </div>

              {solapiBalance !== null && solapiBalance < 2000 && (
                <div className="mb-4">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => window.open('https://solapi.com/cash/recharge', '_blank', 'noopener,noreferrer')} className={`flex-1 flex items-center justify-center gap-1 bg-[#2563EB] text-white font-bold py-2.5 rounded-xl shadow-lg shadow-blue-500/30 border border-blue-600 active:scale-95 transition-all text-xs ${solapiBalance < 2000 ? 'animate-pulse' : ''}`}>
                      <span className="material-symbols-outlined text-[16px]">payments</span> 즉시 충전하기
                    </button>
                    <button type="button" onClick={() => window.open('https://solapi.com/support', '_blank', 'noopener,noreferrer')} className="shrink-0 flex items-center justify-center gap-1 bg-yellow-400 text-yellow-900 font-bold px-3 py-2.5 rounded-xl shadow-sm border border-yellow-500 active:scale-95 transition-all text-xs">
                      <span className="material-symbols-outlined text-[16px]">sms</span> 문의
                    </button>
                  </div>
                  <div className="mt-3 bg-blue-50/80 border border-blue-100 p-3 rounded-xl flex items-start gap-2 shadow-sm">
                    <span className="material-symbols-outlined text-[16px] text-blue-600 mt-0.5">tips_and_updates</span>
                    <div>
                      <p className="text-[11px] text-blue-900 leading-relaxed font-medium tracking-tight">
                        <span className="font-bold text-blue-700">Tip:</span> 솔라피 홈페이지에서 '<span className="font-bold text-blue-700">자동 충전</span>(잔액이 일정 금액 이하로 떨어지면 자동 결제)'을 설정해두시면, 작업 중 잔액 부족으로 문자가 발송되지 않는 상황을 방지할 수 있습니다.
                      </p>
                      <button type="button" onClick={() => window.open('https://solapi.com/cash/auto-recharge', '_blank', 'noopener,noreferrer')} className="mt-1.5 text-[10px] text-blue-600 font-bold underline hover:text-blue-800 transition-colors inline-flex items-center gap-0.5">
                        [설정 방법 보기] <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <p className="text-[10px] text-slate-500 mb-4 font-medium leading-relaxed">작업 완료 시 메시지 앱을 열지 않고 백그라운드 서버를 통해 즉시 문자를 전송합니다. <a href="#" onClick={(e) => { e.preventDefault(); setShowSolapiGuide(true); }} className="text-blue-500 underline font-bold">문자 연동 안내 보기</a></p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">API Key</label>
                  <input type="password" value={editSolapiApiKey} onChange={e => setEditSolapiApiKey(e.target.value)} className="w-full text-sm p-3 rounded-xl border bg-slate-50 text-slate-700 placeholder:text-xs" placeholder="NCS..." />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">API Secret</label>
                  <input type="password" value={editSolapiApiSecret} onChange={e => setEditSolapiApiSecret(e.target.value)} className="w-full text-sm p-3 rounded-xl border bg-slate-50 text-slate-700 placeholder:text-xs" placeholder="Secret Key..." />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">발신번호 (- 제외)</label>
                  <input type="text" value={editSolapiFromNumber} onChange={e => setEditSolapiFromNumber(e.target.value)} className="w-full text-sm p-3 rounded-xl border bg-slate-50 text-slate-700 placeholder:text-xs" placeholder="01012345678" />
                </div>
              </div>
            </div>

            <button onClick={handleSaveProfile} disabled={isSavingSettings} className="w-full py-4 bg-slate-800 text-white font-bold rounded-[1.2rem] shadow-lg active:scale-95 transition-all flex justify-center items-center gap-2">
              <span className="material-symbols-outlined">save</span>
              {isSavingSettings ? '저장 중...' : '템플릿 및 발송 설정 저장'}
            </button>
            <button
              onClick={async (e) => {
                e.preventDefault();
                try {
                  if (!editSolapiApiKey || !editSolapiApiSecret || !editSolapiFromNumber) {
                    return alert('API Key, API Secret, 발신번호를 모두 입력해주세요.');
                  }
                  const date = new Date().toISOString();
                  const salt = window.crypto.randomUUID().replace(/-/g, '');
                  const encoder = new TextEncoder();
                  const key = await window.crypto.subtle.importKey('raw', encoder.encode(editSolapiApiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
                  const signatureBuffer = await window.crypto.subtle.sign('HMAC', key, encoder.encode(date + salt));
                  const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

                  const cleanNumber = editSolapiFromNumber.replace(/[^0-9]/g, '');
                  const res = await fetch('https://api.solapi.com/messages/v4/send', {
                    method: 'POST',
                    headers: {
                      'Authorization': `HMAC-SHA256 apiKey=${editSolapiApiKey}, date=${date}, salt=${salt}, signature=${signature}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      message: {
                        to: cleanNumber,
                        from: cleanNumber,
                        text: '[클린브로] 솔라피 설정 성공! 테스트 문자가 정상 통신되었습니다.'
                      }
                    })
                  });

                  const resData = await res.json();
                  if (res.ok) {
                    alert('성공! 대표님 폰으로 테스트 문자가 발송되었습니다.');
                  } else {
                    alert(`발송 실패: ${resData.errorMessage || resData.errorCode || res.statusText}`);
                  }
                } catch (e) { alert('테스트 발송 중 오류: ' + e.message); }
              }}
              className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-[1.2rem] shadow-sm active:scale-95 transition-all flex justify-center items-center gap-2 border"
            >
              <span className="material-symbols-outlined text-[18px]">cell_tower</span>
              나에게 테스트 문자 보내기
            </button>
          </div>

          <div className="text-center">
            <p className="text-xs text-slate-400 font-bold mb-1">우리 업체 식별 코드 (파트너 초대 시 필요)</p>
            <p className="text-[10px] bg-slate-200 p-2 rounded text-slate-600 break-all select-all font-mono">{myBusinessId}</p>
          </div>

          <div className="bg-red-50 p-5 rounded-2xl border border-red-100">
            <h3 className="font-bold text-sm text-red-600 mb-3 flex items-center gap-1">
              <span className="material-symbols-outlined text-[18px]">rule_folder</span> 과세 유형 일괄 변경
            </h3>
            <p className="text-[10px] text-red-500/80 font-medium mb-4 leading-tight">
              특정 기간 동안 저장된 매출(예약)과 지출 내역의 과세 기준을 일괄 업데이트합니다.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-[10px] font-bold text-red-400 mb-1">시작 날짜</label>
                <input type="date" value={bulkStartDate} onChange={e => setBulkStartDate(e.target.value)} className="w-full text-xs p-2 rounded-lg border bg-white outline-none focus:ring-1 focus:ring-red-400 text-slate-700" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-red-400 mb-1">종료 날짜</label>
                <input type="date" value={bulkEndDate} onChange={e => setBulkEndDate(e.target.value)} className="w-full text-xs p-2 rounded-lg border bg-white outline-none focus:ring-1 focus:ring-red-400 text-slate-700" />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-[10px] font-bold text-red-400 mb-1">변경할 과세 유형</label>
              <select value={bulkTaxType} onChange={e => setBulkTaxType(e.target.value)} className="w-full text-xs p-2 rounded-lg border bg-white outline-none focus:ring-1 focus:ring-red-400 text-slate-700">
                <option value="간이과세자">간이과세자</option>
                <option value="일반과세자">일반과세자</option>
              </select>
            </div>
            <button disabled={isBulking} onClick={handleBulkTaxUpdate} className="w-full py-2.5 bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm active:scale-95 transition-transform flex justify-center items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">{isBulking ? 'sync' : 'auto_fix_high'}</span>
              {isBulking ? '일괄 업데이트 중...' : '데이터 일괄 적용하기'}
            </button>
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
                  <option value="차량유지비">차량유지비</option>
                  <option value="광고비">광고비</option>
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

            <div className="flex gap-2">
              <button disabled={isSavingExpense} type="submit" className="flex-1 py-3.5 bg-primary text-white font-bold rounded-xl active:scale-95 transition-transform flex justify-center gap-2 items-center">
                <span className="material-symbols-outlined">{isSavingExpense ? 'sync' : editingExpenseId ? 'save' : 'add_circle'}</span>
                {isSavingExpense ? '저장 중...' : editingExpenseId ? '지출 내역 수정 완료' : '지출 내역 등록'}
              </button>
              {editingExpenseId && (
                <button
                  type="button"
                  onClick={() => { setEditingExpenseId(null); setExAmount(''); setExMemo(''); setExReceiptFile(null); }}
                  className="px-4 bg-slate-200 text-slate-600 font-bold rounded-xl active:scale-95 transition-all"
                >
                  취소
                </button>
              )}
            </div>
          </form>

          <div>
            <h3 className="font-bold text-sm text-slate-600 mb-2 px-1">최근 지출 내역 ({expenses.length}건)</h3>
            <div className="space-y-2">
              {expenses.map(e => (
                <div key={e.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] text-sm border-0 flex justify-between items-center group">
                  <div className="flex-1">
                    <span className="font-bold flex items-center gap-1">
                      {e.memo || e.category}
                      {e.receipt_url && <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded ml-1 font-bold">영수증 보기</a>}
                    </span>
                    <span className="text-xs text-slate-400 block mt-1">{e.date_created} · {e.category}</span>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => handleEditExpense(e)} className="text-[10px] font-bold text-slate-400 hover:text-primary flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[12px]">edit</span> 수정
                      </button>
                      <button onClick={() => handleDeleteExpense(e.id)} className="text-[10px] font-bold text-slate-400 hover:text-red-500 flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[12px]">delete</span> 삭제
                      </button>
                    </div>
                  </div>
                  <div className="font-black text-red-500 text-right">
                    {fmtNum(e.amount)}원
                  </div>
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
        const aiAdvice = getAiTaxAdvice();
        const currentYear = new Date().getFullYear();
        const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
        const isTaxMonth = [1, 5, 7, 11].includes(taxMonth);
        const taxAlertText = taxMonth === 1 || taxMonth === 7 ? "부가가치세 확정 신고 달입니다!" : taxMonth === 5 ? "종합소득세 신고 달입니다!" : taxMonth === 11 ? "종합소득세 중간예납 달입니다!" : "";
        const isCurrentlyGeneral = businessProfile?.taxpayer_type === '일반과세자';

        return (
          <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-5 animate-slide-up pb-24">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">account_balance</span> 세무 및 절세 대시보드
            </h2>

            <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-2 rounded-xl border-2 border-slate-100 dark:border-slate-700 shadow-sm">
              <select value={taxYear} onChange={e => setTaxYear(Number(e.target.value))} className="bg-transparent font-bold text-center px-2 py-2 outline-none w-1/2 border-r dark:border-slate-700">
                {years.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select value={taxMonth} onChange={e => setTaxMonth(Number(e.target.value))} className="bg-transparent font-bold text-center px-2 py-2 outline-none w-1/2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => <option key={m} value={m}>{m}월</option>)}
              </select>
            </div>

            {isTaxMonth && (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-xl border border-red-200 dark:border-red-800/50 flex font-bold items-center gap-2 animate-pulse">
                <span className="material-symbols-outlined">notification_important</span>
                이 달은 {taxAlertText}
              </div>
            )}

            <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border-0">
              <p className="text-xs font-bold text-slate-400 text-center mb-1">선택 기간 예상 부가가치세</p>
              <p className="text-[10px] text-primary bg-primary/10 w-fit mx-auto px-2 py-0.5 rounded-full font-bold mb-5">
                현재 [{businessProfile.taxpayer_type || '간이과세자'}] 과세자 기준
              </p>

              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 dark:border-slate-700">
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">➕ 기간 내 매출 세액</span>
                  <span className="font-black text-red-500">{fmtNum(taxInfo.salesTax)}원</span>
                  <p className="w-full text-[10px] text-slate-400 mt-1 col-span-2 text-right">과세매출 합계: {fmtNum(taxInfo.taxableSales)}원</p>
                </div>

                <div className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 dark:border-slate-700">
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">➖ 매입(지출) 공제 세액</span>
                  <span className="font-black text-green-600">-{fmtNum(taxInfo.purchaseTax)}원</span>
                  <p className="w-full text-[10px] text-slate-400 mt-1 col-span-2 text-right">등록된 총 지출액 합계: {fmtNum(taxInfo.thisMonthExpenses)}원</p>
                </div>

                {taxInfo.creditCardDeduction > 0 && (
                  <div className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 dark:border-slate-700">
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">➖ 신용카드 등 발행공제</span>
                    <span className="font-black text-green-600">-{fmtNum(taxInfo.creditCardDeduction)}원</span>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 text-center border overflow-hidden relative">
                <p className="text-xs font-bold text-slate-500 mb-1">최종 예상 납부 세액</p>
                <p className="text-3xl font-black text-primary">{fmtNum(taxInfo.finalTax)}원</p>
              </div>
            </div>

            <button onClick={exportToCSV} className="w-full py-4 bg-slate-800 text-white font-bold rounded-xl active:scale-95 transition-transform flex justify-center items-center gap-2 shadow-md">
              <span className="material-symbols-outlined">mail</span>
              {taxYear}년치 자료 엑셀(CSV) 저장 & 세무사 메일 보내기
            </button>

            {/* 부가세 환급 대상 분석 */}
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 p-5 rounded-[1.5rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
              <h4 className="font-extrabold text-indigo-800 dark:text-indigo-400 text-base mb-3 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[20px]">recommend</span> 부가세 환급 대상 분석 (선택 기간)
              </h4>
              <p className="text-[10px] text-indigo-500 font-bold mb-3">
                * 자재/장비, 유류비, 차량유지비, 광고비 카테고리에 해당하는 지출만 필터링합니다.
              </p>

              <div className="space-y-2">
                {expenses
                  .filter(e => e.date_created?.startsWith(`${taxYear}-${String(taxMonth).padStart(2, '0')}`))
                  .filter(e => ['자재/장비', '유류비', '차량유지비', '광고비'].includes(e.category))
                  .map(e => (
                    <div key={e.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-indigo-100 flex justify-between items-center text-sm">
                      <div className="flex-1 overflow-hidden">
                        <span className="font-bold flex items-center gap-1 truncate text-slate-700 dark:text-slate-300">
                          {e.memo || e.category}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">{e.date_created} · {e.category}</span>
                      </div>
                      <div className="text-right ml-2 flex-shrink-0">
                        <div className="font-black text-slate-600">{fmtNum(e.amount)}원</div>
                        {e.receipt_url ? (
                          <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1 py-0.5 rounded">
                            환급 예상: {fmtNum(Math.floor(e.amount * 0.1))}원 (10%)
                          </span>
                        ) : (
                          <span className="text-[10px] text-red-500 font-bold bg-red-50 px-1 py-0.5 rounded">
                            🚨 증빙 보완 필요
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                {expenses
                  .filter(e => e.date_created?.startsWith(`${taxYear}-${String(taxMonth).padStart(2, '0')}`))
                  .filter(e => ['자재/장비', '유류비', '차량유지비', '광고비'].includes(e.category)).length === 0 && (
                    <p className="text-center text-xs text-slate-400 py-3 bg-white/50 rounded-xl">해당 기간 환급 가능 지출이 없습니다.</p>
                  )}
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 p-5 rounded-[1.5rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
              <h4 className="font-extrabold text-blue-800 dark:text-blue-400 text-base mb-3 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[20px]">smart_toy</span> AI 세무 전략 어드바이저
              </h4>
              <div className="space-y-3">
                {aiAdvice.yrSales >= 70000000 && aiAdvice.yrSales < 104000000 && !isCurrentlyGeneral && (
                  <p className="text-sm bg-white dark:bg-slate-800 p-3 rounded-xl border border-blue-100 dark:border-blue-800/50 leading-relaxed font-medium text-slate-700 dark:text-slate-300">
                    <span className="text-red-500 font-bold mr-1">⚠️ 주의:</span>
                    올해 누적 매출이 8천만 원에 근접했습니다. 내년에 <span className="font-bold underline">일반과세자로 강제 전환</span>될 가능성이 매우 높습니다. 매입 세금계산서를 철저히 준비하세요!
                  </p>
                )}
                {aiAdvice.totalMoExp > 0 && aiAdvice.receiptRatio < 0.5 && (
                  <p className="text-sm bg-white dark:bg-slate-800 p-3 rounded-xl border border-blue-100 dark:border-blue-800/50 leading-relaxed font-medium text-slate-700 dark:text-slate-300">
                    <span className="text-orange-500 font-bold mr-1">💡 조언:</span>
                    이번 달 지출 대비 수취한 증빙(영수증) 내역이 {Math.round(aiAdvice.receiptRatio * 100)}% 로 현저히 부족합니다! 자재 구입 시 꼭 세금계산서나 현금영수증(지출증빙용)을 챙기세요.
                  </p>
                )}
                <p className="text-sm bg-white dark:bg-slate-800 p-3 rounded-xl border border-blue-100 dark:border-blue-800/50 leading-relaxed font-medium text-slate-700 dark:text-slate-300">
                  <span className="text-blue-500 font-bold mr-1">📊 시뮬레이터:</span>
                  만약 이번 달부터 <span className="font-bold">일반과세자</span>였다면, {isCurrentlyGeneral ? "현재와 동일한" : `예상 세액은 약 [${fmtNum(aiAdvice.simulatedGenTax)}원] 입니다.`}
                  {!isCurrentlyGeneral && aiAdvice.simulatedGenTax < taxInfo.finalTax && " (현행 간이과세 유지보다 일반과세 전환 시 매입 공제 환급 혜택이 더 클 수 있습니다!)"}
                </p>
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 p-5 rounded-[1.5rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
              <h4 className="font-extrabold text-yellow-800 dark:text-yellow-500 text-base mb-3 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[20px]">lightbulb</span> [청소업 특화] 절세 가이드
              </h4>
              <ul className="text-sm text-yellow-800 dark:text-yellow-600/90 space-y-2.5 list-disc pl-4 font-medium break-keep">
                <li><span className="font-bold">고가의 청소 장비(고압세척기, 산업용 청소기 등)</span> 구입 시 반드시 세금계산서를 발급받으세요. 부가세 10% 전액 공제가 가능합니다.</li>
                <li>청소업종 특성 상 <span className="font-bold">차량 유지비와 유류비</span> 비중이 높습니다. 홈택스에 사업자 카드를 등록하여 매입세액 공제를 극대화하세요!</li>
                <li>오픈마켓(숨고, 미소 등) 플랫폼 이용 수수료 역시 국세청 홈택스에서 전자세금계산서로 자동 수취 가능 여부를 세팅해 두시면 편합니다.</li>
                <li className="text-[11px] text-yellow-600/70 mt-3 list-none -ml-4">* 위 세액은 단순 부가가치세(10%) 계산으로, 추가 공제 비율이나 사업소득 종합소득세는 세무사와 상담을 권장합니다.</li>
              </ul>
            </div>

            {/* 과세 유형 일괄 변경 섹션 (새로 추가) */}
            <div className="bg-slate-100 dark:bg-slate-800 p-5 rounded-[1.5rem] mt-6 border-2 border-dashed border-slate-300">
              <h4 className="font-bold text-sm mb-3 text-slate-600">⚠️ 과세 유형 일괄 소급 적용</h4>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={bulkStartDate} onChange={e => setBulkStartDate(e.target.value)} className="w-full text-xs p-2 rounded-lg border bg-white" />
                  <input type="date" value={bulkEndDate} onChange={e => setBulkEndDate(e.target.value)} className="w-full text-xs p-2 rounded-lg border bg-white" />
                </div>
                <select value={bulkTaxType} onChange={e => setBulkTaxType(e.target.value)} className="w-full text-xs p-2 rounded-lg border bg-white">
                  <option value="간이과세자">간이과세자</option>
                  <option value="일반과세자">일반과세자</option>
                </select>
                <button
                  onClick={handleBulkTaxUpdate}
                  disabled={isBulking}
                  className="w-full py-2 bg-slate-600 text-white text-xs font-bold rounded-lg hover:bg-slate-700 active:scale-95 transition-all"
                >
                  {isBulking ? '적용 중...' : '[일괄 적용] 선택 기간 데이터 변경'}
                </button>
              </div>
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

          <button onClick={() => setCurrentTab('proshop')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'proshop' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'proshop' ? 'font-fill' : ''}`}>local_mall</span>
            <p className={`text-[9px] ${currentTab === 'proshop' ? 'font-bold' : 'font-medium'}`}>프로샵</p>
          </button>

          <button onClick={() => setCurrentTab('settings')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'settings' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'settings' ? 'font-fill' : ''}`}>manage_accounts</span>
            <p className={`text-[9px] ${currentTab === 'settings' ? 'font-bold' : 'font-medium'}`}>설정</p>
          </button>
        </div>
      </nav>

      {/* ======================= [탭 7: 프로 샵] ======================= */}
      {currentTab === 'proshop' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-5 animate-slide-up pb-32">
          <div className="flex justify-between items-end mb-2">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">local_mall</span> 프로 샵
            </h2>
            {isCeo && (
              <button onClick={() => { setEditingProduct({ title: '', description: '', image_url: '', link_url: '', category: '에어컨', platform: '쿠팡', tag: '' }); setShowProductModal(true); }} className="text-xs font-bold bg-slate-800 text-white px-3 py-1.5 rounded-xl active:scale-95 shadow-sm">
                + 상품 추가
              </button>
            )}
          </div>

          <div className="flex gap-2 pb-2 overflow-x-auto scrollbar-hide">
            {['전체', '에어컨', '세탁기'].map(cat => (
              <button
                key={cat}
                onClick={() => setProductCategory(cat)}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap border line-clamp-1 ${productCategory === cat ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {recommendedProducts
              .filter(p => productCategory === '전체' || p.category === productCategory)
              .map(p => (
                <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl p-3 shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col cursor-pointer active:scale-95 transition-transform" onClick={() => window.open(p.link_url, '_blank')}>
                  <div className="relative aspect-square rounded-xl bg-slate-50 overflow-hidden mb-3">
                    <img src={p.image_url} alt={p.title} className="w-full h-full object-cover" />
                    <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                      {p.platform === '쿠팡' && <span className="bg-[#C82A1D] text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm tracking-wide">COUPANG</span>}
                      {p.platform === '알리' && <span className="bg-[#FF4747] text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm tracking-wide">AliExpress</span>}
                      <span className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm">🔥 10년 경력자 Pick</span>
                    </div>
                  </div>
                  {p.tag && <span className="self-start text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mb-1">{p.tag}</span>}
                  <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100 line-clamp-2 leading-tight mb-1">{p.title}</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 flex-1">{p.description}</p>
                  {p.platform === '알리' && (
                    <p className="text-[9px] text-orange-500 font-bold mt-1.5 leading-tight flex items-start gap-0.5 bg-orange-50 p-1.5 rounded-lg border border-orange-100 shrink-0">
                      <span className="material-symbols-outlined text-[10px]">flight_takeoff</span>
                      해외 직구 상품으로 배송에 7~14일이 소요될 수 있습니다.
                    </p>
                  )}
                  {isCeo && (
                    <div className="mt-2 flex gap-1 justify-end border-t border-slate-50 pt-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingProduct(p); setShowProductModal(true); }} className="text-[10px] text-blue-500 font-bold px-2 py-1 bg-blue-50 rounded">수정</button>
                      <button onClick={() => handleDeleteProduct(p.id)} className="text-[10px] text-red-500 font-bold px-2 py-1 bg-red-50 rounded">삭제</button>
                    </div>
                  )}
                </div>
              ))}
            {recommendedProducts.filter(p => productCategory === '전체' || p.category === productCategory).length === 0 && (
              <div className="col-span-2 text-center text-xs text-slate-400 py-10 bg-white/50 rounded-2xl">등록된 상품이 없습니다.</div>
            )}
          </div>

          <div className="mt-8 pt-4 border-t border-slate-200/50">
            <p className="text-[10px] text-slate-400 text-center font-medium">이 포스팅은 쿠팡 파트너스 활동의 일환으로 수수료를 제공받습니다.</p>
          </div>
        </main>
      )}

      {/* 상품 추가/수정 모달 */}
      {showProductModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-fade-in font-display">
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl overflow-hidden animate-slide-up">
            <h3 className="text-lg font-black mb-4 flex items-center gap-1.5"><span className="material-symbols-outlined text-primary">edit_square</span> 상품 등록 / 수정</h3>
            <form onSubmit={handleSaveProduct} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">카테고리</label>
                <select value={editingProduct.category} onChange={e => setEditingProduct({ ...editingProduct, category: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm">
                  <option>에어컨</option>
                  <option>세탁기</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">플랫폼 연동 배지</label>
                  <select value={editingProduct.platform || '쿠팡'} onChange={e => setEditingProduct({ ...editingProduct, platform: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm">
                    <option value="쿠팡">쿠팡 (Coupang)</option>
                    <option value="알리">알리 (AliExpress)</option>
                    <option value="없음">사용 안함</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">강조 태그</label>
                  <select value={editingProduct.tag || ''} onChange={e => setEditingProduct({ ...editingProduct, tag: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm">
                    <option value="">선택 안함</option>
                    <option value="🚀 빠른배송">🚀 빠른배송</option>
                    <option value="💰 가성비최고">💰 가성비최고</option>
                    <option value="👍 경력자추천">👍 경력자추천</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">상품명</label>
                <input type="text" required value={editingProduct.title} onChange={e => setEditingProduct({ ...editingProduct, title: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">한줄 설명</label>
                <input type="text" value={editingProduct.description} onChange={e => setEditingProduct({ ...editingProduct, description: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">이미지 URL</label>
                <input type="url" required value={editingProduct.image_url} onChange={e => setEditingProduct({ ...editingProduct, image_url: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm placeholder:text-xs" placeholder="https://..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">상품 외부 링크 URL</label>
                <input type="url" required value={editingProduct.link_url} onChange={e => setEditingProduct({ ...editingProduct, link_url: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm placeholder:text-xs" placeholder="https://..." />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowProductModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl active:scale-95 text-sm">취소</button>
                <button type="submit" className="flex-1 py-3 bg-primary text-white font-bold rounded-xl active:scale-95 text-sm">저장하기</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 솔라피 연동 가이드 모달 */}
      {showSolapiGuide && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in font-display" onClick={() => setShowSolapiGuide(false)}>
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm h-[80vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900 shrink-0">
              <h3 className="font-black text-lg text-slate-800 dark:text-white flex items-center gap-1">
                <span className="material-symbols-outlined text-primary">menu_book</span> 🛠️ 파트너 문자 연동 안내
              </h3>
              <button onClick={() => setShowSolapiGuide(false)} className="text-slate-400 hover:text-slate-600 bg-white rounded-full p-1 shadow-sm border">
                <span className="material-symbols-outlined block text-[20px]">close</span>
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-6">
              <div className="space-y-2">
                <h4 className="font-bold text-sm text-blue-600">1. 솔라피(Solapi) 가입하기</h4>
                <p className="text-xs text-slate-600 leading-relaxed">회원가입 후 이메일 인증을 진행해 주세요. (가입 시 포인트 지급 혜택)</p>
                <a href="https://solapi.com" target="_blank" rel="noreferrer" className="text-blue-500 text-xs font-bold underline inline-block mt-1">솔라피 바로가기</a>
              </div>
              <div className="space-y-2">
                <h4 className="font-bold text-sm text-blue-600">2. 발신번호 등록하기</h4>
                <p className="text-xs text-slate-600 leading-relaxed">[발신번호 관리] 메뉴에서 대표님 명의의 휴대폰 번호를 문자인증하여 등록합니다. 이 번호가 고객에게 노출됩니다.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-bold text-sm text-blue-600">3. API 키 발급 및 복사</h4>
                <p className="text-xs text-slate-600 leading-relaxed">[개발자 센터] - [API Key 관리]에서 새 키를 생성한 후, 'API Key'와 'API Secret' 두 가지를 모두 복사합니다.</p>
              </div>
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mt-4">
                <p className="text-xs font-bold text-blue-800 mb-1">💡 복사한 키를 어떻게 하나요?</p>
                <p className="text-[11px] text-blue-600/80">방금 열어두셨던 [나의 문자 발송 설정 (개별)] 창의 API Key와 API Secret 칸에 붙여넣고 하단의 '설정 저장' 버튼을 누르시면 됩니다.</p>
              </div>
            </div>
            <div className="p-4 shrink-0 border-t border-slate-100 bg-white dark:bg-slate-900">
              <button onClick={() => setShowSolapiGuide(false)} className="w-full py-4 bg-slate-800 text-white font-bold rounded-2xl active:scale-95 transition-transform text-sm">확인했습니다</button>
            </div>
          </div>
        </div>
      )}

      {/* ======================= [탭 8: 모달들] ======================= */}

      {/* 1. 목표 매출 수정 모달 */}
      {showTargetEdit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-[2rem] p-8 shadow-2xl animate-slide-up">
            <h3 className="text-xl font-black mb-1 flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500">trending_up</span> 목표 매출 설정
            </h3>
            <p className="text-xs font-bold text-slate-400 mb-6 font-display">이번 달 대표님의 꿈의 매출액을 적어주세요!</p>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1 ml-1">목표 금액 (원)</label>
                <input
                  type="text"
                  value={fmtNum(newTargetRevenue)}
                  onChange={e => setNewTargetRevenue(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full p-4 rounded-2xl border-2 border-slate-100 focus:border-primary outline-none text-2xl font-black text-right pr-4"
                  placeholder="0"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-2 font-display">
                <button
                  onClick={() => setShowTargetEdit(false)}
                  className="flex-1 py-4 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-all text-sm"
                >취소</button>
                <button
                  onClick={handleSaveTarget}
                  className="flex-1 py-4 bg-primary text-white font-black rounded-2xl shadow-lg shadow-primary/30 active:scale-95 transition-all text-sm"
                >저장하기</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 작업 완료 & 사진 업로드 모달 */}
      {showCompletionModal && completionTarget && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-md p-0 overflow-hidden font-display">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-t-[2.5rem] shadow-2xl h-[92vh] flex flex-col animate-slide-up relative">

            <div className="h-1.5 w-12 bg-slate-300 rounded-full mx-auto my-4 shrink-0"></div>

            <div className="flex justify-between items-center px-6 mb-2 shrink-0">
              <div>
                <h2 className="text-xl font-black">{completionTarget.customer_name || '고객'}님 작업 완료</h2>
                <p className="text-xs font-bold text-slate-400 mt-1">현장 사진을 등록하고 고객님께 보고하세요.</p>
              </div>
              <button onClick={() => setShowCompletionModal(false)} className="p-2 bg-slate-100 rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">

              {/* BEFORE */}
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <h4 className="font-black text-blue-600 flex items-center gap-1 text-sm"><span className="material-symbols-outlined text-sm">cleaning_services</span> 작업 전 실황 (Before)</h4>
                  <span className="text-[10px] font-bold text-slate-400">{beforeFiles.length}/5</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {beforeFiles.map((f, i) => (
                    <div key={i} className="aspect-square rounded-xl bg-slate-100 relative overflow-hidden group">
                      <img src={URL.createObjectURL(f)} className="w-full h-full object-cover" />
                      <button onClick={() => setBeforeFiles(beforeFiles.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="material-symbols-outlined text-xs">close</span>
                      </button>
                    </div>
                  ))}
                  {beforeFiles.length < 5 && (
                    <label className="aspect-square rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 cursor-pointer active:bg-slate-50 transition-colors">
                      <span className="material-symbols-outlined text-2xl">add_a_photo</span>
                      <span className="text-[10px] font-black mt-1">사진 추가</span>
                      <input type="file" multiple accept="image/*" onChange={e => setBeforeFiles([...beforeFiles, ...Array.from(e.target.files)].slice(0, 5))} className="hidden" />
                    </label>
                  )}
                </div>
              </div>

              {/* AFTER */}
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <h4 className="font-black text-green-600 flex items-center gap-1 text-sm"><span className="material-symbols-outlined text-sm">magic_button</span> 작업 후 광채 (After)</h4>
                  <span className="text-[10px] font-bold text-slate-400">{afterFiles.length}/5</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {afterFiles.map((f, i) => (
                    <div key={i} className="aspect-square rounded-xl bg-slate-100 relative overflow-hidden group">
                      <img src={URL.createObjectURL(f)} className="w-full h-full object-cover" />
                      <button onClick={() => setAfterFiles(afterFiles.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="material-symbols-outlined text-xs">close</span>
                      </button>
                    </div>
                  ))}
                  {afterFiles.length < 5 && (
                    <label className="aspect-square rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 cursor-pointer active:bg-slate-50 transition-colors">
                      <span className="material-symbols-outlined text-2xl">add_a_photo</span>
                      <span className="text-[10px] font-black mt-1">사진 추가</span>
                      <input type="file" multiple accept="image/*" onChange={e => setAfterFiles([...afterFiles, ...Array.from(e.target.files)].slice(0, 5))} className="hidden" />
                    </label>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 space-y-2">
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1"><span className="material-symbols-outlined text-xs">info</span> AI 이미지 자동 처리 안내</p>
                <ul className="text-[10px] text-slate-400 font-medium space-y-1 ml-1">
                  <li>- 이미지는 최적의 품질로 압축 및 리사이징됩니다 (데이터 절약)</li>
                  <li>- 사진 우측 하단에 [클린브로 | {businessProfile.company_name}] 워터마크가 삽입됩니다.</li>
                </ul>
              </div>

            </div>

            <div className="p-6 shrink-0 border-t bg-white dark:bg-slate-900 pb-10">
              <button
                disabled={isUploadingPhotos}
                onClick={handleFinalComplete}
                className="w-full py-4.5 bg-primary text-white font-black rounded-[1.5rem] shadow-xl shadow-primary/30 flex items-center justify-center gap-2 active:scale-95 transition-all text-lg"
              >
                {isUploadingPhotos ? (
                  <><span className="material-symbols-outlined animate-spin">sync</span> 처리 및 업로드 중...</>
                ) : (
                  <><span className="material-symbols-outlined">send</span> 완벽하게 완료 & 고객 메시지 전송</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. 인앱 브라우저 경고 모달 (카카오톡 등) */}
      {showInAppBrowserWarning && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] p-6 w-full max-w-sm shadow-2xl relative overflow-hidden animate-slide-up">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-yellow-400 to-yellow-500"></div>

            <div className="flex flex-col items-center text-center mt-2 mb-6">
              <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mb-4 shadow-inner">
                <span className="material-symbols-outlined text-4xl text-yellow-600">open_in_browser</span>
              </div>
              <h2 className="text-xl font-black text-slate-900 mb-2">외부 브라우저(크롬)로 열어주세요!</h2>
              <p className="text-sm text-slate-500 font-medium leading-relaxed">
                현재 접속하신 환경(카카오톡 등)에서는<br />결제나 이미지 업로드 등 일부 기능이<br /><span className="text-red-500 font-bold">정상적으로 작동하지 않을 수 있습니다.</span>
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold text-center text-slate-400">👇 아래 버튼을 눌러 링크를 복사하세요 👇</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href).then(() => {
                    alert('✅ 주소가 복사되었습니다!\n크롬(Chrome)이나 사파리 앱을 열고 붙여넣기 해주세요.');
                  }).catch(() => {
                    alert('주소 복사에 실패했습니다. 우측 상단 메뉴에서 "다른 브라우저로 열기"를 선택해주세요.');
                  });
                }}
                className="w-full bg-[#FFE812] text-[#3A1D1D] font-black py-4 rounded-2xl shadow-lg border border-[#FBE000] active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">content_copy</span>
                앱 주소 복사하기
              </button>

              <button
                onClick={() => setShowInAppBrowserWarning(false)}
                className="w-full py-3 text-slate-400 font-bold text-sm hover:bg-slate-50 rounded-xl transition-all"
              >
                닫기 (이대로 무시하고 사용)
              </button>
            </div>

            <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-[10px] text-slate-500 font-medium text-center">
                <span className="font-bold text-slate-700">추가 팁:</span> 화면 우측 상단(또는 우측 하단)의 [ ⋮ ] 버튼을 누른 후, <span className="font-bold">"다른 브라우저로 열기"</span>를 선택하셔도 됩니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4. 업데이트 토스트 (PWA Update) */}
      {showUpdateToast && (
        <div className="fixed bottom-24 left-4 right-4 z-[100] animate-slide-up font-display">
          <div className="bg-slate-800 text-white p-4 rounded-2xl shadow-2xl flex items-center justify-between border border-slate-700 backdrop-blur-md bg-slate-800/95">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-primary">system_update</span>
              </div>
              <div>
                <p className="text-sm font-black">새로운 기능이 추가되었습니다!</p>
                <p className="text-[10px] text-slate-400">앱을 새로고침하여 최신 버전을 적용하세요.</p>
              </div>
            </div>
            <button
              onClick={() => {
                if (swRegistration && swRegistration.waiting) {
                  swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                window.location.reload();
              }}
              className="bg-primary text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg shadow-primary/20 active:scale-95 transition-all"
            >
              지금 업데이트
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
