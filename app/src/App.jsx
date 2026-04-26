import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabase';
import confetti from 'canvas-confetti';
import { toBlob } from 'html-to-image';

// --- 유틸리티 및 데이터 ---
// UUID v4 폴백 생성기 (구형 브라우저 대응)
const genUUID = () => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const getTodayStr = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
};

const CATEGORIES = {
  '에어컨': ['벽걸이', '스탠드', '2in1', '시스템'],
  '세탁기': ['통돌이', '드럼', '아기용'],
  '에어컨 설치': ['스탠드 설치', '벽걸이 설치', '냉매 보충'],
  '인스턴티': ['커스텀 티셔츠', '가족/단체티', '유니폼(대량)', '원데이 클래스']
};

const DEFAULT_PRICES = {
  '벽걸이': 80000,
  '스탠드': 120000,
  '2in1': 200000,
  '시스템': 100000,
  '통돌이': 100000,
  '드럼': 160000,
  '아기용': 70000,
  '커스텀 티셔츠': 25000,
  '가족/단체티': 100000,
  '유니폼(대량)': 150000,
  '원데이 클래스': 40000
};

// 2026, 2027 주요 공휴일 (대체공휴일 포함)
const PUBLIC_HOLIDAYS = [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', 
  '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-06', '2026-08-15', '2026-08-17', 
  '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-03-01', '2027-05-05', 
  '2027-05-13', '2027-06-06', '2027-08-15', '2027-09-14', '2027-09-15', '2027-09-16', 
  '2027-10-03', '2027-10-09', '2027-12-25'
];

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

// 90바이트 SMS 길이 제한 유틸리티 (LMS/MMS 요금 폭탄 방지)
const truncateToSMS = (str) => {
  let byteLength = 0;
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    const charCode = char.charCodeAt(0);
    // 한글 등 다국어는 2바이트, 영어/숫자/공백/기호는 1바이트 처리 (euc-kr 통상 기준)
    const byteSize = charCode <= 0x00007F ? 1 : 2;
    if (byteLength + byteSize > 90) break;
    byteLength += byteSize;
    result += char;
  }
  return result;
};


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
    reminder_template: '',
    auto_confirm_sms: false,
    auto_morning_reminders: false
  });

  const [currentTab, setCurrentTab] = useState('calendar'); // calendar, add, list, stats, settings, tax_expense, proshop, notice
  const [taxExpenseSubTab, setTaxExpenseSubTab] = useState('expense'); // expense, tax, quotation
  
  // 견적서 관련 상태
  const [quoteTarget, setQuoteTarget] = useState('');
  const [quoteProject, setQuoteProject] = useState('에어컨 분해청소');
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [quoteItems, setQuoteItems] = useState([{ id: Date.now(), name: '벽걸이 에어컨 완전분해청소', qty: 1, unitPrice: 80000 }]);
  const [quoteVatType, setQuoteVatType] = useState('included'); // 'included', 'excluded'
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
  // 업로드 완료 후 공유 대기 데이터 { files: File[], text: string, fallbackSmsUrl: string }
  const [pendingShare, setPendingShare] = useState(null);

  // 블로그 초안 생성 관련 상태

  const [manualDraftInfo, setManualDraftInfo] = useState({ address: '', category: '에어컨', product: '벽걸이', memo: '' });
  const BOT_URL = 'http://localhost:8765';  // Python bot address

  // 당근마켓 소식 연동 상태
  const [socialPosts, setSocialPosts] = useState([]);
  const [isFetchingSocialPosts, setIsFetchingSocialPosts] = useState(false);

  // 블로그 5슬롯 자동화 상태
  const [showBatchBlogModal, setShowBatchBlogModal] = useState(false);
  const [batchSlots, setBatchSlots] = useState([
    { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' },
    { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' },
    { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' },
    { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' },
    { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' }
  ]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgressText, setBatchProgressText] = useState("");

  // 파트너(개별) 프로필 추가 정보 및 솔라피
  const [userProfile, setUserProfile] = useState({});
  const [solapiBalance, setSolapiBalance] = useState(null);
  const [showSolapiGuide, setShowSolapiGuide] = useState(false);
  const [editSolapiApiKey, setEditSolapiApiKey] = useState('');
  const [editSolapiApiSecret, setEditSolapiApiSecret] = useState('');
  const [editSolapiFromNumber, setEditSolapiFromNumber] = useState('');
  const [isTestingSms, setIsTestingSms] = useState(false);


  // 프로 샵(Pro Shop) 상태
  const [products, setProducts] = useState([]);
  const [productCategory, setProductCategory] = useState('전체');
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState({ title: '', description: '', image_url: '', link_url: '', category: '에어컨', platform: '쿠팡', tag: '', price: '', stock: '' });
  const [productImageFile, setProductImageFile] = useState(null);

  // 쇼츠 AI 상태
  const [shortsView, setShortsView] = useState("home"); // home | create | loading | result
  const [shortsTopic, setShortsTopic] = useState("");
  const [shortsCategory, setShortsCategory] = useState("감동/힐링");
  const [shortsDuration, setShortsDuration] = useState("60");
  const [shortsScript, setShortsScript] = useState("");
  const [shortsError, setShortsError] = useState("");
  const SHORTS_CATEGORIES = ["감동/힐링", "반전/충격", "정보/교육", "유머", "동기부여"];
  
  // AI 피드백 회의 관련 상태
  const [aiMeetingIssue, setAiMeetingIssue] = useState('');
  const [aiMeetingCategory, setAiMeetingCategory] = useState('인스턴티');
  const [isGeneratingMeeting, setIsGeneratingMeeting] = useState(false);
  const [aiGuidelines, setAiGuidelines] = useState(() => localStorage.getItem('ai_blog_guidelines') || '');

  // 인증 및 모드 관련 상태
  const [isResetMode, setIsResetMode] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // 설치 가이드 및 온보딩 상태
  const [activeInstallGuide, setActiveInstallGuide] = useState(null); // 'iphone', 'android', or null
  const [hideNoticeAuto, setHideNoticeAuto] = useState(() => localStorage.getItem('hide_notice_v1') === 'true');
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  // PWA 업데이트 감지용
  const detailRef = useRef(null);
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [swRegistration, setSwRegistration] = useState(null);
  const APP_VERSION = "v1.1.8"; // 현재 버젼

  // 인앱 브라우저 감지 (카카오톡 등)
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [showInAppBrowserWarning, setShowInAppBrowserWarning] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [settingsMsgSubTab, setSettingsMsgSubTab] = useState('completion'); // completion, auto_sms
  const [settingsActiveMenu, setSettingsActiveMenu] = useState('main'); // main, profile, message, sms, invite, bulk

  // ==========================================
  // [인증 관련 (Supabase Auth)]
  // ==========================================
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const android = /android/.test(ua);
    setIsAndroid(android);

    if (ua.includes('kakaotalk') || (ua.indexOf('inapp') !== -1) || ua.includes('line') || ua.includes('instagram') || ua.includes('fb') || ua.includes('naver')) {
      setIsInAppBrowser(true);
      setShowInAppBrowserWarning(true);
    }

    // URL 경로 및 파라미터 감지 (초대용)
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const codeFromUrl = searchParams.get('code');

    if (path.includes('signup') || searchParams.has('signup')) {
      setIsLoginMode(false);
      if (codeFromUrl) setInviteCode(codeFromUrl);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      // 비밀번호 재설정 링크로 접속한 경우 감지
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoveryMode(true);
      }
      // 로그인 시 공지사항 자동 이동 로직 (한 번도 안 봤을 경우)
      if (session && localStorage.getItem('hide_notice_v1') !== 'true' && !isRecoveryMode) {
        setCurrentTab('notice');
      }
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

    if (isRecoveryMode) {
      // 비밀번호 변경 처리
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      error = updateError;
      if (!error) {
        alert('비밀번호가 성공적으로 변경되었습니다! 새로운 비밀번호로 로그인해 주세요.');
        setIsRecoveryMode(false);
        setIsLoginMode(true);
        await supabase.auth.signOut();
      }
    } else if (isResetMode) {
      // 비밀번호 재설정 메일 발송
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      error = resetError;
      if (!error) {
        alert('비밀번호 재설정 링크가 이메일로 발송되었습니다. 메일함을 확인해 주세요!');
        setIsResetMode(false);
        setIsLoginMode(true);
      }
    } else if (isLoginMode) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      error = signInError;
      if (!error) {
        if (!rememberMe) sessionStorage.setItem('no_remember', 'true');
        else sessionStorage.removeItem('no_remember');
      }
    } else {
      let finalBusinessId = inviteCode.trim();

      // 커스텀 초대 코드 대조 로직 (입력값이 UUID가 아닌 경우 DB 조회)
      if (finalBusinessId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(finalBusinessId)) {
        const { data: bData } = await supabase.from('businesses').select('id').eq('custom_invite_code', finalBusinessId).single();
        if (bData) finalBusinessId = bData.id;
      }

      const newBusinessId = finalBusinessId || genUUID();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { business_id: newBusinessId },
          emailRedirectTo: window.location.origin
        }
      });
      error = signUpError;
      if (!error) alert('가입 성공! 메일함을 확인하거나 바로 로그인 하세요.');
    }
    setAuthLoading(false);

    const getKoreanError = (err) => {
      const msg = err.message || '';
      if (msg.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 틀렸습니다. 다시 확인해주세요.';
      if (msg.includes('Email not confirmed')) return '이메일 인증이 아직 완료되지 않았습니다. 메일함에서 인증 버튼을 눌러주세요!';
      if (msg.includes('User already registered')) return '이미 가입된 이메일 주소입니다.';
      if (msg.includes('Password should be at least 6 characters')) return '비밀번호는 최소 6자 이상이어야 합니다.';
      if (msg.includes('Invalid email')) return '올바른 이메일 형식을 입력해주세요.';
      if (msg.includes('rate limit')) return '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.';
      if (msg.includes('User not found')) return '등록되지 않은 이메일 주소입니다.';
      return `오류가 발생했습니다: ${msg}`;
    };

    if (error) alert(getKoreanError(error));
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
      const salt = genUUID().replace(/-/g, '');
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
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (!error && data) setProducts(data);
  };

  useEffect(() => {
    if (currentTab === 'settings') fetchSolapiBalance();
  }, [currentTab, userProfile, businessProfile]);

  const fetchTeamMembers = async () => {
    if (!myBusinessId) return;
    const { data, error } = await supabase.from('profiles').select('*').eq('business_id', myBusinessId).order('user_role', { ascending: true });
    if (!error && data) {
      setTeamMembers(data);
    }
  };

  const fetchExpenses = async () => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('business_id', myBusinessId)
        .order('date_created', { ascending: false });
      if (error) throw error;
      setExpenses(data || []);
    } catch (err) {
      console.error('지출 로드 실패', err);
    }
  };

  const fetchSocialPosts = async () => {
    if (!myBusinessId) return;
    setIsFetchingSocialPosts(true);
    try {
      const { data, error } = await supabase
        .from('social_posts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSocialPosts(data || []);
    } catch (err) {
      console.error('당근 소식 로드 실패', err);
    } finally {
      setIsFetchingSocialPosts(false);
    }
  };

  const markSocialPostAsDone = async (postId, currentState) => {
    try {
      const { error } = await supabase
        .from('social_posts')
        .update({ is_posted_karrot: !currentState })
        .eq('id', postId);
      if (error) throw error;
      setSocialPosts(socialPosts.map(p => p.id === postId ? { ...p, is_posted_karrot: !currentState } : p));
    } catch (e) {
      console.error("당근 소식 상태 업데이트 실패", e);
    }
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
        if (!fbErr && fallbackData) setCustomers(fallbackData.filter(c => c.category !== '블로그자동화'));
        else setCustomers([]);
      } catch (e) {
        setCustomers([]);
      }
    } else {
      setCustomers((data || []).filter(c => c.category !== '블로그자동화'));
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
          fetchCustomers();
        })
        .subscribe();

      const productSubscription = supabase
        .channel('public:products')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => {
          fetchProducts();
        })
        .subscribe();

      // 알림 권한 요청
      if (typeof Notification !== 'undefined' && Notification.permission !== "denied") {
        Notification.requestPermission();
      }

      return () => {
        supabase.removeChannel(bookingSubscription);
        supabase.removeChannel(productSubscription);
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
    setIsSamsungCheck(c.is_samsung_check || false);
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
  const [discountType, setDiscountType] = useState('amount');
  const [discountVal, setDiscountVal] = useState(10000);
  const [payment, setPayment] = useState('현금');
  const [bookDate, setBookDate] = useState(() => {
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    return tmr.toISOString().split('T')[0];
  });
  const [bookTimeType, setBookTimeType] = useState('09:00');
  const [bookTimeCustom, setBookTimeCustom] = useState('');
  const [endDate, setEndDate] = useState('');
  const [assignee, setAssignee] = useState(() => localStorage.getItem('default_assignee') || '');
  const [isAssigneePinned, setIsAssigneePinned] = useState(() => localStorage.getItem('default_assignee') !== null);
  const [isCompleted, setIsCompleted] = useState(false); // 완료 상태 유지용
  const [isSamsungCheck, setIsSamsungCheck] = useState(false); // 삼성 체크 여부
  const [serviceType, setServiceType] = useState('에어컨'); // 썸네일용 서비스 종류
  const [modelName, setModelName] = useState(''); // 썸네일용 모델명
  const [isSavingBooking, setIsSavingBooking] = useState(false);

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
    
    if (isSamsungCheck) {
      const samsungPrices = {
        '벽걸이': 70000,
        '스탠드': 110000,
        '2in1': 173000,
        '통돌이': 90000,
        '드럼': 150000
      };
      setBasePrice(samsungPrices[targetProduct] || DEFAULT_PRICES[targetProduct] || 0);
      setDiscountType('none');
      setDiscountVal('');
    } else {
      setBasePrice(DEFAULT_PRICES[targetProduct] || 0);
      setDiscountType('amount');
      if (targetProduct === '2in1') {
        setDiscountVal(20000);
      } else if (['벽걸이', '스탠드', '시스템', '통돌이', '드럼'].includes(targetProduct)) {
        setDiscountVal(10000);
      } else {
        setDiscountType('none');
        setDiscountVal('');
      }
    }
  }, [category, product, isSamsungCheck]);

  const finalPrice = useMemo(() => {
    let totalBase = (Number(basePrice) || 0) * (Number(qty) || 1);
    const dVal = Number(discountVal) || 0;

    if (discountType === 'percent') {
      totalBase = Math.max(0, totalBase - (totalBase * (dVal / 100)));
    } else if (discountType === 'amount') {
      totalBase = Math.max(0, totalBase - dVal);
    }

    // 현금 결제이면서 영수증/계산서 필요시, 또는 카드 결제 시 10% 부가세 추가 (원단위 내림 처리)
    if ((payment === '현금' && (hasCashReceipt || hasTaxInvoice)) || payment === '카드') {
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

  const sendSolapiMmsLocally = async (to, text, imageUrls = []) => {
    const activeApiKey = userProfile?.solapi_api_key || businessProfile?.solapi_api_key;
    const activeApiSecret = userProfile?.solapi_api_secret || businessProfile?.solapi_api_secret;
    const activeFromNumber = userProfile?.solapi_from_number || userProfile?.sender_number || businessProfile?.solapi_from_number || businessProfile?.phone;

    console.log('Attempting SMS send with:', { hasKey: !!activeApiKey, hasSecret: !!activeApiSecret, from: activeFromNumber, to: to });

    if (!activeApiKey || !activeApiSecret || !activeFromNumber) {
      throw new Error("솔라피 연동 설정(API 키, 시크릿, 발신번호)을 확인해주세요.");
    }

    const { data, error } = await supabase.functions.invoke('send-sms', {
      body: {
        action: 'send_custom_sms',
        apiKey: activeApiKey,
        apiSecret: activeApiSecret,
        fromNumber: activeFromNumber,
        to: to.replace(/[^0-9]/g, ''),
        text,
        imageUrls
      }
    });

    if (error) {
      console.error('Edge Function invoke detail:', error);
      let errorMsg = error.message;

      // FunctionsHttpError 혹은 일반적인 응답 바디 추출 시도
      if (error.context?.json) {
        try {
          const body = await error.context.json();
          if (body && body.error) errorMsg = body.error;
          else if (body && body.message) errorMsg = body.message;
        } catch (e) {
          console.warn("Failed to parse error context json", e);
        }
      } else if (error.details) {
        // 일부 버전이나 상황에서 details에 에러 내용이 담김
        errorMsg = typeof error.details === 'string' ? error.details : JSON.stringify(error.details);
      }

      throw new Error("Edge Function 호출 에러: " + errorMsg);
    }
    if (data?.error) throw new Error("문자 발송 실패: " + data.error);

    // Solapi의 응답 구조에 따라 성공 여부 판단 (보통 statusCode 2000이나 null)
    return data;
  };

  const [blogQueue, setBlogQueue] = useState([]);

  const fetchBlogQueue = async () => {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('business_id', myBusinessId)
        .eq('category', '블로그자동화')
        .order('id', { ascending: false });
        
      if (!error && data) {
        const q = data.map(d => {
          let memoObj = {};
          try { memoObj = JSON.parse(d.memo || "{}"); } catch(e) {}
          return {
            id: d.id,
            title: memoObj.title || '제목 없음',
            status: d.product, // pending, processing, completed, failed
            error: memoObj.error || null,
            published_url: memoObj.published_url || null,
            save_as_draft: memoObj.save_as_draft === true,
            scheduled_for: new Date(d.created_at).getTime() / 1000
          };
        });
        setBlogQueue(q);
      }
    } catch(e) { }
  };

  useEffect(() => {
    if (showBatchBlogModal) fetchBlogQueue();
  }, [showBatchBlogModal]);

  const deleteFromQueue = async (id) => {
    if(!window.confirm('기록을 삭제하시겠습니까? (이미 발행된 글은 블로그에서 직접 지워야 합니다)')) return;
    try {
      const { error } = await supabase.from('bookings').delete().eq('id', id);
      if (error) throw error;
      fetchBlogQueue();
    } catch (err) {
      alert('취소 실패: ' + err.message);
    }
  };

  const retryQueueTask = async (id) => {
    if (!window.confirm('에러가 발생한 블로그 자동발행 작업을 재시도하시겠습니까?\n사진이나 데이터를 다시 넣을 필요 없이 즉시 로봇이 다시 가동됩니다.')) return;
    try {
      const { error } = await supabase.from('bookings').update({ product: 'pending' }).eq('id', id);
      if (error) throw error;
      fetchBlogQueue();
      alert('재시도 대기열에 진입했습니다! 까만 창(로봇)이 반응하는지 확인해보세요 🚀');
    } catch (err) {
      alert('재시도 설정 실패: ' + err.message);
    }
  };

  // ===========================================
  // [5슬롯 일괄 자동 초안 및 임시저장 로직]
  // ===========================================
  const handleBatchImageUpload = (slotIndex, type, files) => {
    const newSlots = [...batchSlots];
    const fileArray = Array.from(files);
    if (type === 'before') newSlots[slotIndex].beforeFiles = fileArray;
    if (type === 'after') newSlots[slotIndex].afterFiles = fileArray;
    setBatchSlots(newSlots);
  };

  const startBatchProcess = async (isImmediatePublish = false) => {
    // 1. 상태 변수가 아닌 실제 업로드할 활성 슬롯만 추출 (전/후 사진이 모두 있는 슬롯만)
    const activeSlots = batchSlots.filter(slot => slot.beforeFiles.length > 0 && slot.afterFiles.length > 0);
    
    // 일부만 채운 경우 사용자에게 명확히 알려줌
    const partiallyFilled = batchSlots.filter(
      slot => (slot.beforeFiles.length > 0 && slot.afterFiles.length === 0) || (slot.beforeFiles.length === 0 && slot.afterFiles.length > 0)
    );

    if (partiallyFilled.length > 0) {
      alert('일부 슬롯에 전/후 사진 중 하나만 등록되어 있습니다. 한 슬롯에는 전/후 사진이 모두 있어야 합니다.');
      return;
    }

    if (activeSlots.length === 0) {
      alert('최소 1개의 슬롯에 청소 전/후 사진을 모두 첨부해야 합니다.');
      return;
    }

    if (blogQueue.length + activeSlots.length > 30) {
      alert(`예약 대기열은 최대 30개까지만 유지할 수 있습니다. (현재 대기열 ${blogQueue.length}개 + 신규 등록 ${activeSlots.length}개 초과)`);
      return;
    }

    setIsBatchProcessing(true);

    try {
      for (let i = 0; i < activeSlots.length; i++) {
        setBatchProgressText(`${i + 1}/${activeSlots.length} 처리 중... (이미지 업로드)`);

        const uploadOne = async (file, type) => {
          try {
            const arrayBuffer = await processImage(file);
            const fileName = `${myBusinessId}/batch_blog/${type}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;
            const { error: upErr } = await supabase.storage.from('receipts').upload(fileName, arrayBuffer, {
              contentType: 'image/jpeg',
              upsert: false
            });
            if (upErr) throw upErr;
            const { data } = supabase.storage.from('receipts').getPublicUrl(fileName);
            return data.publicUrl;
          } catch (err) {
            throw new Error(`이미지 업로드 실패 (${file.name}): ${err.message || '알 수 없는 오류'}`);
          }
        };

        const uploadAllSequentially = async (files, type) => {
          const urls = [];
          for (let idx = 0; idx < files.length; idx++) {
            urls.push(await uploadOne(files[idx], type));
          }
          return urls;
        };

        let beforeUrls = [];
        let afterUrls = [];
        try {
           beforeUrls = await uploadAllSequentially(activeSlots[i].beforeFiles, 'before');
           afterUrls = await uploadAllSequentially(activeSlots[i].afterFiles, 'after');
        } catch (err) {
           throw new Error(`슬롯 ${i+1} 업로드 단계 오류: ${err.message}`);
        }
        
        const allUrls = [...beforeUrls, ...afterUrls];

        setBatchProgressText(`${i + 1}/${activeSlots.length} 스케줄러 큐 등록 중 (PC 봇 인계)...`);
        
        const draftImageUrls = [];
        if (beforeUrls.length > 0) draftImageUrls.push(beforeUrls[0]);
        if (afterUrls.length > 0) draftImageUrls.push(afterUrls[0]);

        const { error: insErr } = await supabase.from('bookings').insert({
          business_id: myBusinessId,
          user_id: session.user.id,
          customer_name: `블로그자동화_대기열`,
          category: '블로그자동화',
          product: 'pending', // pending, processing, completed, failed
          book_date: getTodayStr(), 
          book_time_type: '예약', 
          phone: "000-0000-0000",
          memo: JSON.stringify({
            title: `AI 초안 작성 대기 중 (${activeSlots[i].category})`,
            body: "",
            tags: [],
            photo_alt_texts: [],
            image_urls: allUrls,
            draft_image_urls: draftImageUrls, // AI 분석용 2장
            category: activeSlots[i].category,
            product: activeSlots[i].product,
            customer_name: activeSlots[i].customer_name || '고객명',
            address: activeSlots[i].address || '',
            save_as_draft: !isImmediatePublish,
            needs_gemini: true, // PC 파이썬 봇에게 AI 작성을 지시
            businessProfile: businessProfile,
            aiGuidelines: aiGuidelines
          }),
          is_completed: false
        });

        if (insErr) throw new Error(insErr.message || '스케줄링 등록 실패');
      }

      setBatchProgressText(`✅ ${activeSlots.length}건 예약 발행 대기열 등록 완료! (이제 스마트폰 화면을 끄셔도 PC가 알아서 처리합니다)`);
      // Update UI 큐 대시보드
      fetchBlogQueue();
      fetchSocialPosts(); // 당근소식 업데이트
      
      setTimeout(() => {
        setIsBatchProcessing(false);
        setBatchSlots([
          { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' },
          { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' },
          { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' },
          { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' },
          { beforeFiles: [], afterFiles: [], category: '에어컨', product: '벽걸이', customer_name: '', address: '' }
        ]);
      }, 2000);

    } catch (e) {
      alert(`일괄 처리 중 오류 발생: ${e.message}\n\n※ 데이터가 그대로 보존되어 있습니다!\n절대로 창을 새로고침(F5)하지 마시고 '예약 발행 시작' 버튼만 다시 눌러주세요.`);
      setIsBatchProcessing(false);
      setBatchProgressText("");
    }
  };

  const handleCopyShortsScript = () => {
    navigator.clipboard.writeText(shortsScript);
    alert('스크립트가 복사되었습니다!');
  };

  const generateShortsScript = async () => {
    if (!shortsTopic.trim()) { setShortsError("주제를 입력해주세요!"); return; }
    setShortsError("");
    setShortsView("loading");

    const prompt = `당신은 한국 유튜브 쇼츠 전문 작가입니다. 시청자는 주로 50~70대 여성입니다.

다음 조건으로 쇼츠 스크립트를 작성해주세요:
- 주제: ${shortsTopic}
- 카테고리: ${shortsCategory}
- 영상 길이: ${shortsDuration}초
- 말하는 속도 기준, ${shortsDuration}초 분량의 나레이션
- 감정이입이 잘 되는 구어체
- 후킹 첫문장으로 시작
- 마지막에 구독 유도 멘트 포함

형식:
[후킹 도입부]
(내용)

[본문]
(내용)

[마무리 & 구독 유도]
(내용)

---
⏱ 예상 시간: ${shortsDuration}초
`;

    try {
      const { data: { session } } = await supabase.auth.getSession();

      // We will proxy this through an edge function to keep API keys secure eventually.
      // For now, if anthropic key is directly exposed or we mock it:
      // Note: Ideally you should create a Supabase edge function `generate-shorts-script` 
      // similar to `generate-blog-draft` to prevent Anthropic key leaking.
      // Here is a simulated direct API call placeholder or we just use gemini edge function to mock it temporary.

      // Let's use Gemini edge function for script generation since Anthropic key is not provided in env.
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-blog-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          imageUrls: [],
          category: shortsCategory,
          memo: `쇼츠 스크립트 작성 요청! 프롬프트:\n${prompt}`,
          businessProfile: {}
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      const draft = data.draft;
      setShortsScript(draft.title + '\n\n' + draft.body);
      setShortsView("result");
    } catch (e) {
      setShortsError("생성 실패. 다시 시도해주세요. " + e.message);
      setShortsView("create");
    }
  };





  const handleBulkDeleteDuplicates = async (dateStr) => {
    if (!window.confirm(`${dateStr}일자의 중복된 예약들을 깔끔하게 정리할까요?\n(고객명과 시간, 상품이 완전히 일치하는 쌍둥이 예약들 중 1개만 남기고 싹 다 지웁니다!)`)) return;
    
    const list = customers.filter(c => c.book_date === dateStr);
    const seen = new Set();
    const toDelete = [];
    
    for (const c of list) {
        const key = `${c.customer_name}_${c.phone}_${c.book_time_type}_${c.product}`;
        if (seen.has(key)) {
            toDelete.push(c.id);
        } else {
            seen.add(key);
        }
    }
    
    if (toDelete.length === 0) {
        alert('삭제할 찌꺼기 중복 데이터가 없습니다.');
        return;
    }
    
    const { error } = await supabase.from('bookings').delete().in('id', toDelete);
    if (!error) {
        alert(`사장님, ${toDelete.length}개의 중복 찌꺼기를 시원하게 쳐냈습니다!`);
        fetchCustomers();
    } else {
        alert('삭제 중 오류 발생: ' + error.message);
    }
  };

  const resetBookingForm = () => {
    setEditingId(null);
    setCustomerName('');
    setNewPhone('');
    setAddress('');
    setAddressDetail('');
    setHasCashReceipt(false);
    setHasTaxInvoice(false);
    setNewMemo('');
    setCategory('에어컨');
    setProduct('벽걸이');
    setQty(1);
    setBasePrice(DEFAULT_PRICES['벽걸이']);
    setDiscountType('amount');
    setDiscountVal(10000);
    setPayment('현금');
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    setBookDate(tmr.toISOString().split('T')[0]);
    setBookTimeType('09:00');
    setBookTimeCustom('');
    setEndDate('');
    setIsCompleted(false);
    setIsSamsungCheck(false);
    setServiceType('에어컨');
    setModelName('');
  };

  const handleSaveBooking = async () => {
    if (isSavingBooking) return;
    
    if (!newPhone.trim() || !address.trim()) {
      alert('전화번호와 주소를 모두 입력해주세요.');
      return;
    }

    setIsSavingBooking(true);

    if (!editingId) {
      const isDuplicate = customers.some(c =>
        c.book_date === bookDate &&
        c.book_time_type === bookTimeType &&
        (bookTimeType !== '직접입력' || c.book_time_custom === bookTimeCustom)
      );
      if (isDuplicate) {
        if (!window.confirm('⚠️ 선택하신 날짜/시간에 이미 다른 예약이 있습니다. 계속 저장하시겠습니까?')) {
          setIsSavingBooking(false);
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
      is_samsung_check: isSamsungCheck,
      service_type: serviceType,
      model_name: modelName,
      date_created: getTodayStr(),
      applied_tax_type: businessProfile?.taxpayer_type || '간이과세자',
    };

    let error;
    let responseData = null;

    let durationDays = 1;
    if (endDate) {
      const start = new Date(bookDate);
      const end = new Date(endDate);
      if (end >= start) durationDays = Math.min(30, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
    }

    if (editingId) {
      const firstDayEntry = {
        ...entry,
        book_date: bookDate,
        final_price: finalPrice,
        memo: durationDays > 1 ? `${newMemo} [${durationDays}일의 일정 중 1일차]` : newMemo
      };
      
      const { error: updErr, data } = await supabase.from('bookings').update(firstDayEntry).eq('id', editingId).select();
      error = updErr;
      responseData = data;

      if (!error && durationDays > 1) {
        const entriesToInsert = [];
        for (let i = 1; i < durationDays; i++) {
          const d = new Date(bookDate);
          d.setDate(d.getDate() + i);
          const nextDateStr = d.toISOString().split('T')[0];
          entriesToInsert.push({
            ...entry,
            book_date: nextDateStr,
            final_price: 0, // 첫 날에만 매출액 합산
            memo: `${newMemo} [${durationDays}일의 일정 중 ${i+1}일차]`
          });
        }
        const { error: insErr, data: insData } = await supabase.from('bookings').insert(entriesToInsert).select();
        if (!insErr && responseData && insData) {
          responseData = [...responseData, ...insData];
        }
      }

      if (!error) alert('예약이 수정되었습니다.');
    } else {
      const entriesToInsert = [];
      for (let i = 0; i < durationDays; i++) {
        const d = new Date(bookDate);
        d.setDate(d.getDate() + i);
        const nextDateStr = d.toISOString().split('T')[0];
        entriesToInsert.push({
          ...entry,
          book_date: nextDateStr,
          final_price: i === 0 ? finalPrice : 0, // 첫 날에만 매출액 잡힘
          memo: durationDays > 1 ? `${newMemo} [${durationDays}일의 일정 중 ${i+1}일차]` : newMemo
        });
      }
      const { error: insErr, data } = await supabase.from('bookings').insert(entriesToInsert).select();
      error = insErr;
      responseData = data;
    }

    if (error) {
      alert('저장 실패: ' + error.message);
      setIsSavingBooking(false);
      return;
    }

    if (!editingId && responseData && responseData.length > 0) {
      supabase.functions.invoke('send-sms', {
        body: { action: 'send_webhook_manual', record: responseData[0] }
      }).catch(err => console.error("SMS Invoke Error:", err));
    }

    // 🌟 속도 최적화: 수백 개의 데이터를 다시 불러오지 않고(fetchCustomers) 방금 저장/수정된 데이터만 화면에 바로 꽂아줍니다!
    if (responseData && responseData.length > 0) {
      if (editingId) {
        setCustomers(prev => {
          let updated = prev.map(c => (c.id === editingId ? responseData[0] : c));
          if (responseData.length > 1) {
            updated = [...updated, ...responseData.slice(1)];
          }
          return updated;
        });
      } else {
        setCustomers(prev => [...prev, ...responseData]);
      }
    } else {
      fetchCustomers(); // 예상치 못한 에러 시에만 백그라운드 재조회
    }

    resetBookingForm();
    setCurrentTab('calendar');
    setIsSavingBooking(false);
  };

  const handleCancelEdit = () => {
    resetBookingForm();
    setCurrentTab('calendar');
  };

  // ==========================================
  // [탭: 설정 (Settings)]
  // ==========================================
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editBusinessPhone, setEditBusinessPhone] = useState('');
  const [editLogoFile, setEditLogoFile] = useState(null);
  const [editNickname, setEditNickname] = useState(''); // 본인 닉네임 설정
  const [editPersonalPhone, setEditPersonalPhone] = useState(''); // 개인 폰 번호 (파트너 노출용 추가)
  const [editTaxpayerType, setEditTaxpayerType] = useState('간이과세자'); // 과세자 유형
  const [editDefaultMessage, setEditDefaultMessage] = useState('');
  const [editNoticeTemplate, setEditNoticeTemplate] = useState('');
  const [editReminderTemplate, setEditReminderTemplate] = useState('');
  const [editConfirmedTemplate, setEditConfirmedTemplate] = useState('');
  const [editMorningReminderTemplate, setEditMorningReminderTemplate] = useState('');
  const [editAutoConfirmSms, setEditAutoConfirmSms] = useState(false);
  const [editAutoMorningReminders, setEditAutoMorningReminders] = useState(false);
  const [editAutoPartnerSms, setEditAutoPartnerSms] = useState(true); // 기본값 true
  const [editCustomInviteCode, setEditCustomInviteCode] = useState('');
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
      setEditPersonalPhone(userProfile?.sender_number || '');
      setEditTaxpayerType(businessProfile.taxpayer_type || '간이과세자');
      setEditDefaultMessage(businessProfile.default_completion_message || `[클린브로] 청소 작업 완료 안내\n안녕하세요, 고객님! {customer_name}님 {memo} 작업이 완료되었습니다.\n\n📸 작업 사진 확인하기:\n{after_url}\n\n만족하셨다면 리뷰 부탁드립니다!\n[리뷰링크]`);
      setEditNoticeTemplate(businessProfile.notice_template || `[안내] 오늘 방문 예정입니다. 시간 맞춰 뵙겠습니다.\n- 클린브로 ([시간])`);
      setEditReminderTemplate(businessProfile.reminder_template || `[알림] [고객명]님, 곧 도착 예정입니다. 잠시만 기다려주세요!`);
      setEditConfirmedTemplate(businessProfile.confirmed_template || `[예약 확정] [일시]에 예약이 완료되었습니다. - 클린브로 ([파트너전화번호])`);
      setEditMorningReminderTemplate(businessProfile.morning_reminder_template || `[알림] 오늘 [시간]에 방문 예정입니다. 뵙겠습니다! - 클린브로 ([파트너전화번호])`);
      setEditAutoConfirmSms(businessProfile.auto_confirm_sms || false);
      setEditAutoMorningReminders(businessProfile.auto_morning_reminders || false);
      setEditAutoPartnerSms(businessProfile.auto_partner_sms ?? true);
      setEditCustomInviteCode(businessProfile.custom_invite_code || '');
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
      auto_confirm_sms: editAutoConfirmSms,
      auto_morning_reminders: editAutoMorningReminders,
      auto_partner_sms: editAutoPartnerSms,
      custom_invite_code: editCustomInviteCode
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
      sender_number: editPersonalPhone,
      solapi_api_key: editSolapiApiKey,
      solapi_api_secret: editSolapiApiSecret,
      solapi_from_number: editSolapiFromNumber
    }]);

    if (bError || pError) {
      alert('프로필 저장 실패: ' + (bError?.message || pError?.message));
    } else {
      setBusinessProfile(upsertData);
      setMyNickname(editNickname);
      setUserProfile(prev => ({ ...prev, nickname: editNickname, sender_number: editPersonalPhone, solapi_api_key: editSolapiApiKey, solapi_api_secret: editSolapiApiSecret, solapi_from_number: editSolapiFromNumber }));
      alert('업체 정보 및 내 닉네임이 성공적으로 업데이트되었습니다.');
      fetchTeamMembers(); // 업데이트 후 팀원 목록 즉시 갱신
      fetchSolapiBalance(); // 설정 저장 직후 솔라피 잔액 재조회
    }
    setIsSavingSettings(false);
  };

  const handleTestSms = async () => {
    if (!editSolapiApiKey || !editSolapiApiSecret || !editSolapiFromNumber) {
      alert("솔라피 API Key, Secret, 발신번호를 모두 입력한 후 테스트해 주세요.");
      return;
    }

    const testPhone = window.prompt("테스트 문자를 받을 전화번호를 입력하세요.", editSolapiFromNumber);
    if (!testPhone) return;

    setIsTestingSms(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: {
          action: 'send_custom_sms',
          apiKey: editSolapiApiKey,
          apiSecret: editSolapiApiSecret,
          fromNumber: editSolapiFromNumber,
          to: testPhone.replace(/[^0-9]/g, ''),
          text: `[클린브로] 솔라피 연동 테스트 성공! 이 메시지가 보인다면 문자가 정상적으로 발송되는 상태입니다.`
        }
      });

      if (error) {
        let errStr = error.message;
        if (error.context?.json) {
          try {
            const body = await error.context.json();
            if (body && (body.error || body.message)) {
              errStr = body.error || body.message;
            }
          } catch (e) {
            console.warn("Failed to parse error context", e);
          }
        }
        throw new Error(errStr);
      }
      if (data?.error) throw new Error(data.error);

      alert("테스트 문자가 성공적으로 발송되었습니다! 수신 여부를 확인해 보세요.");
      fetchSolapiBalance(); // 잔액 업데이트
    } catch (err) {
      console.error('Test SMS error detail:', err);
      alert("테스트 발송 실패: " + err.message);
    } finally {
      setIsTestingSms(false);
    }
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
  const [exHasCashReceipt, setExHasCashReceipt] = useState(false);
  const [exHasTaxInvoice, setExHasTaxInvoice] = useState(false);
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
      has_cash_receipt: exHasCashReceipt,
      has_tax_invoice: exHasTaxInvoice,
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
      setExHasCashReceipt(false); setExHasTaxInvoice(false);
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
    setExHasCashReceipt(exp.has_cash_receipt || false);
    setExHasTaxInvoice(exp.has_tax_invoice || false);
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
      const isRecognizedPurchase = e.has_tax_invoice || e.has_cash_receipt;

      if (isRecognizedPurchase) {
        if (taxType === '일반과세자') {
          totalPurchaseTax += Math.floor(e.amount * 0.1);
        } else {
          totalPurchaseTax += Math.floor(e.amount * 0.005);
        }
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
    
    // 예약 시간을 기준으로 정렬 (빈 문자열이 앞으로 오지 않고, 정상적으로 비교되게 처리)
    list.sort((a, b) => {
      const timeA = (a.book_time_type === '직접입력' ? a.book_time_custom : a.book_time_type) || '';
      const timeB = (b.book_time_type === '직접입력' ? b.book_time_custom : b.book_time_type) || '';
      return timeA.localeCompare(timeB);
    });

    return { total, cash, card, list };
  };

  // ==========================================
  // [탭: 일정/달력 (Calendar)]
  // ==========================================
  const [calDate, setCalDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [showAllSchedule, setShowAllSchedule] = useState(false); // 전체 일정 보기 토글 상태 추가

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

  const todayTargetList = useMemo(() => {
    const arr = customers.filter(c => c.book_date === getTodayStr() && c.category !== '블로그자동화');
    arr.sort((a, b) => {
      const timeA = (a.book_time_type === '직접입력' ? a.book_time_custom : a.book_time_type) || '';
      const timeB = (b.book_time_type === '직접입력' ? b.book_time_custom : b.book_time_type) || '';
      return timeA.localeCompare(timeB);
    });
    return arr;
  }, [customers]);
  const [batchSmsIdx, setBatchSmsIdx] = useState(-1);

  const handleSendSms = async (c, type = 'confirmed') => {
    let template = '';
    let updateField = '';

    if (type === 'confirmed') {
      template = businessProfile.confirmed_template || `[클린브로] [일시] 방문예정. 감사합니다!`;
      updateField = 'sms_sent_initial';
    } else {
      template = businessProfile.morning_reminder_template || `[클린브로] 오늘 [시간] 방문예정. 뵙겠습니다!`;
      updateField = 'sms_sent_reminder';
    }

    const timeValue = c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type;
    const senderPhone = userProfile?.solapi_from_number || businessProfile?.solapi_from_number || businessProfile?.phone || '';

    let msg = template
      .replace(/\[고객명\]/g, c.customer_name || '고객')
      .replace(/\[일시\]/g, `${c.book_date} ${timeValue}`)
      .replace(/\[시간\]/g, timeValue || '')
      .replace(/\[파트너전화번호\]/g, senderPhone);

    // 문자 길이 90바이트 제한 (SMS만 발송)
    msg = truncateToSMS(msg);

    try {
      if (confirm('자동으로 문자를 발송하시겠습니까?\n(취소 클릭 시 메시지 앱 열기)')) {
        // 1. 완벽한 낙관적 업데이트 - 통신 대기 없이 즉각 화면(UI) 변환 (블로킹 제로)
        if (updateField) {
          setCustomers(prev => prev.map(item => item.id === c.id ? { ...item, [updateField]: true } : item));
        }

        // 2. 비동기 백그라운드 문자 발송 (결과를 기다리지 않음)
        sendSolapiMmsLocally(c.phone, msg).catch(err => {
          console.error('문자 발송 실패 (백그라운드):', err);
          if (updateField) {
            setCustomers(prev => prev.map(item => item.id === c.id ? { ...item, [updateField]: false } : item));
          }
        });

        // 3. 비동기 백그라운드 DB 동기화 (조용히 처리)
        if (updateField) {
          supabase.from('bookings').update({ [updateField]: true }).eq('id', c.id).then(({ error: dbErr }) => {
            if (dbErr) console.error('DB Update Error (배경처리):', dbErr);
          });
        }
      } else {
        // 수동 발송 (사용자가 직접 앱 열기)
        if (updateField) {
          setCustomers(prev => prev.map(item => item.id === c.id ? { ...item, [updateField]: true } : item));
        }
        window.location.href = `sms:${c.phone}?body=${encodeURIComponent(msg)}`;

        // 팝업 이후 뒤에서 DB 조용히 업데이트
        if (updateField) {
          supabase.from('bookings').update({ [updateField]: true }).eq('id', c.id).then(({ error: dbErr }) => {
            if (dbErr) console.error('DB Update Error (배경처리):', dbErr);
          });
        }
      }
    } catch (err) {
      console.error('발송 에러:', err);
      // 극단적 에러 시에만 롤백
      if (updateField) {
        setCustomers(prev => prev.map(item => item.id === c.id ? { ...item, [updateField]: false } : item));
      }
    }
  };

  const handleBatchSmsNext = () => {
    if (batchSmsIdx + 1 < todayTargetList.length) {
      const nextIdx = batchSmsIdx + 1;
      setBatchSmsIdx(nextIdx);
      handleSendSms(todayTargetList[nextIdx], 'morning');
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

  const monthlyCalendarList = useMemo(() => {
    return customers
      .filter(c => {
        const d = new Date(c.book_date);
        return d.getFullYear() === calDate.getFullYear() && d.getMonth() === calDate.getMonth();
      })
      .sort((a, b) => {
        const diff = a.book_date.localeCompare(b.book_date);
        if (diff !== 0) return diff;
        const timeA = (a.book_time_type === '직접입력' ? a.book_time_custom : a.book_time_type) || '';
        const timeB = (b.book_time_type === '직접입력' ? b.book_time_custom : b.book_time_type) || '';
        return timeA.localeCompare(timeB);
      });
  }, [customers, calDate]);

  // --- 솔라피 문자 발송 로직 ---
  const sendSolapiMessage = async (to, text, scheduledAt = null) => {
    const apiKey = import.meta.env.VITE_SOLAPI_API_KEY || userProfile?.solapi_api_key || businessProfile?.solapi_api_key;
    const apiSecret = import.meta.env.VITE_SOLAPI_API_SECRET || userProfile?.solapi_api_secret || businessProfile?.solapi_api_secret;
    const fromNumber = userProfile?.solapi_from_number || userProfile?.sender_number || businessProfile?.solapi_from_number || businessProfile?.phone;

    if (!apiKey || !apiSecret || !fromNumber) throw new Error("솔라피 연동 정보가 없습니다. (설정 탭 확인)");

    const cleanTo = to.replace(/[^0-9]/g, '');
    const cleanFrom = fromNumber.replace(/[^0-9]/g, '');

    console.log(`[디버그] 솔라피 발송 준비: 수신=${cleanTo}, 예약시간=${scheduledAt || '즉시 발송'}\n내용:\n${text}`);

    const date = new Date().toISOString();
    const salt = crypto.randomUUID().replace(/-/g, '');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(date + salt));
    const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const messagePayload = { to: cleanTo, from: cleanFrom, text };
    const url = scheduledAt ? 'https://api.solapi.com/messages/v4/send-many' : 'https://api.solapi.com/messages/v4/send';
    const body = scheduledAt ? { messages: [messagePayload], scheduledDate: scheduledAt } : { message: messagePayload };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.errorMessage || result.message || '문자 발송 실패');
    return result;
  };

  // 아이템 컴포넌트
  const BookingItem = ({ c }) => {
    const [sendingType, setSendingType] = useState(null); // 'confirm' | 'morning' | null

    const longPressHooks = useLongPress(() => {
      const action = window.prompt('수정하려면 1, 삭제하려면 2를 입력하세요.\n(취소는 빈칸)');
      if (action === '1') handleEdit(c);
      else if (action === '2') handleDelete(c.id);
    }, 600);

    const handleSendConfirm = async () => {
      if (c.is_samsung_check) {
        console.log("삼성 체크 예약으로 문자가 발송되지 않았습니다.");
        alert('삼성 체크건으로 문자 발송이 비활성화되었습니다.');
        return;
      }
      if (!c.phone) return alert('고객 연락처가 없습니다.');
      if (!confirm('확정 문자를 바로 발송하시겠습니까?')) return;
      
      setSendingType('confirm');
      try {
        const tpl = businessProfile?.confirmed_template || `[예약 확정] [일시]에 방문 예정입니다. - 클린브로 ([파트너전화번호])`;
        const timeVal = c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type;
        const text = tpl
          .replace(/\[고객명\]/g, c.customer_name || '고객')
          .replace(/\[일시\]/g, `${c.book_date} ${timeVal}`)
          .replace(/\[시간\]/g, timeVal || '')
          .replace(/\[파트너전화번호\]/g, userProfile?.solapi_from_number || businessProfile?.phone || '');
          
        await sendSolapiMessage(c.phone, text);
        const { error } = await supabase.from('bookings').update({ is_confirmed_sent: true }).eq('id', c.id);
        if (error && error.message.includes('column')) {
            await supabase.from('bookings').update({ sms_sent_initial: true }).eq('id', c.id);
            c.sms_sent_initial = true;
        } else if (!error) {
            c.is_confirmed_sent = true;
        }
        alert('확정 문자가 발송되었습니다.');
      } catch (e) {
        alert('발송 실패: ' + e.message);
      } finally {
        setSendingType(null);
      }
    };

    const handleSendMorning = async () => {
      if (c.is_samsung_check) {
        console.log("삼성 체크 예약으로 문자가 발송되지 않았습니다.");
        alert('삼성 체크건으로 문자 발송이 비활성화되었습니다.');
        return;
      }
      if (!c.phone) return alert('고객 연락처가 없습니다.');
      
      // KST 기준 08:00 계산
      const d = new Date(c.book_date);
      d.setHours(8, 0, 0, 0);
      let scheduledUtc = d.toISOString();
      const isPast = d.getTime() <= Date.now();

      if (isPast) {
        if (!confirm('예약 당일 아침 8시가 이미 지났습니다. 지금 즉시 아침 알림 문자를 발송하시겠습니까?')) return;
        scheduledUtc = null; // 과거 시간이면 즉시 발송
      } else {
        if (!confirm('예약 당일 아침 8시로 알림 문자를 예약 발송하시겠습니까?')) return;
      }
      
      setSendingType('morning');
      try {
        const tpl = businessProfile?.morning_reminder_template || `[알림] 오늘 [시간]에 방문 예정입니다. 뵙겠습니다! - 클린브로 ([파트너전화번호])`;
        const timeVal = c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type;
        const text = tpl
          .replace(/\[고객명\]/g, c.customer_name || '고객')
          .replace(/\[시간\]/g, timeVal || '')
          .replace(/\[파트너전화번호\]/g, userProfile?.solapi_from_number || businessProfile?.phone || '');
          
        await sendSolapiMessage(c.phone, text, scheduledUtc);
        const { error } = await supabase.from('bookings').update({ is_morning_alert_sent: true }).eq('id', c.id);
        if (error && error.message.includes('column')) {
            await supabase.from('bookings').update({ sms_sent_reminder: true }).eq('id', c.id);
            c.sms_sent_reminder = true;
        } else if (!error) {
            c.is_morning_alert_sent = true;
        }
        alert(scheduledUtc ? '아침 알림 예약이 완료되었습니다.' : '아침 알림 문자가 즉시 발송되었습니다.');
      } catch (e) {
        alert('발송 실패: ' + e.message);
      } finally {
        setSendingType(null);
      }
    };

    return (
      <div {...longPressHooks} className={`relative p-4 rounded-2xl shadow-sm transition-all active:scale-[0.98] ${c.is_completed ? 'bg-gray-50/50 opacity-80 border-0' : c.is_samsung_check ? 'bg-[#eef2ff] border-[1.5px] border-[#818cf8]' : 'bg-white border-0'}`}>

        {/* 더보기 버튼 (삭제 등 메뉴) */}
        <div className="absolute top-3 right-3">
          <button onClick={(e) => { e.stopPropagation(); if(confirm('정말 삭제하시겠습니까?')) handleDelete(c.id); }} className="p-1 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
            <span className="material-symbols-outlined text-[18px]">more_horiz</span>
          </button>
        </div>

        <div className="flex justify-between items-start mb-2">
          <div className="flex-1 pr-8">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              {c.is_samsung_check && (
                <span className="bg-[#4f46e5] text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm">
                  삼성체크
                </span>
              )}
              {c.memo?.match(/\[(\d+)일의 일정 중 (\d+)일차\]/) && (
                <span className="bg-amber-100 text-amber-700 text-[9px] font-black px-1.5 py-0.5 rounded border border-amber-200 shadow-sm animate-pulse">
                  {c.memo.match(/\[(\d+)일의 일정 중 (\d+)일차\]/)[1]}일 연박 ({c.memo.match(/\[(\d+)일의 일정 중 (\d+)일차\]/)[2]}일차)
                </span>
              )}
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${c.assignee?.includes('2인') ? 'bg-purple-50 text-purple-600 border-purple-200' : 'bg-blue-50 text-blue-600 border-blue-200'}`}>
                {c.assignee}
              </span>
              <span className="bg-slate-200 text-slate-800 text-[13px] sm:text-[14px] font-black px-2 py-0.5 rounded-md shadow-sm border border-slate-300">
                {c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type}
              </span>
              <span className="text-gray-400 text-[10px] font-bold">{c.category} · {c.product}</span>
            </div>

            <h4
              onClick={(e) => { e.stopPropagation(); setMapPopupMemo(c.address ? (c.address + ' ' + (c.address_detail || '')).trim() : c.memo); }}
              className={`font-black text-base cursor-pointer hover:text-blue-600 flex items-center transition-colors ${c.is_completed ? 'text-[#10B981]' : 'text-slate-800'}`}
            >
              {c.customer_name || '이름 없음'}
              {c.is_completed && <span className="material-symbols-outlined text-[#10B981] text-[18px] ml-1">check_circle</span>}
              {c.address && <span className="text-[10px] font-bold text-gray-400 ml-1.5 truncate max-w-[130px]">({c.address.split(' ').slice(0, 2).join(' ')})</span>}
            </h4>

            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-gray-400 font-bold text-xs">
                {c.phone ? c.phone.replace(/^(\d{2,3})(\d{3,4})(\d{4})$/, `$1-$2-$3`) : '번호 없음'}
              </p>
              {c.phone && (
                <a href={`tel:${c.phone}`} className="p-0.5 hover:bg-blue-50 rounded-full text-blue-500 transition-colors">
                  <span className="material-symbols-outlined text-[16px]">call</span>
                </a>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="font-black text-blue-600 text-lg leading-tight">{fmtNum(c.final_price)}원</p>
            <p className="text-[9px] font-bold text-gray-400 mt-0.5">{c.payment_method || '미결제'}</p>
          </div>
        </div>

        {/* 액션 버튼 그룹 */}
        <div className="mt-3 flex gap-1.5 flex-wrap">
          <button onClick={() => {
            if (c.is_completed) {
              toggleCompletion(c);
            } else {
              setCompletionTarget(c);
              setShowCompletionModal(true);
            }
          }} className={`flex-1 min-w-[25%] py-1.5 rounded-lg text-[11px] font-bold transition-all border ${c.is_completed ? 'bg-white border-gray-200 text-gray-400' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 active:scale-[0.98]'}`}>
            {c.is_completed ? '작업 취소' : '작업 완료'}
          </button>
          
          <button 
            disabled={c.is_samsung_check || c.is_confirmed_sent || c.sms_sent_initial || sendingType === 'confirm'}
            onClick={(e) => { e.stopPropagation(); handleSendConfirm(); }}
            title={c.is_samsung_check ? "삼성 체크 건은 문자 발송 제외 대상입니다." : ""}
            className={`flex-none px-2 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-0.5 border transition-all ${
              c.is_samsung_check 
                ? 'bg-gray-100 text-gray-400 border-gray-200 opacity-50 pointer-events-none'
                : (c.is_confirmed_sent || c.sms_sent_initial) 
                  ? 'bg-gray-50 text-gray-400 border-gray-200 disabled:opacity-80' 
                  : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100 active:scale-[0.98] disabled:opacity-80'
            }`}
          >
            <span className="material-symbols-outlined text-[12px]">done_all</span>
            {sendingType === 'confirm' ? '처리중' : ((c.is_confirmed_sent || c.sms_sent_initial) ? '발송완료' : '확정문자')}
          </button>

          <button 
            disabled={c.is_samsung_check || c.is_morning_alert_sent || c.sms_sent_reminder || sendingType === 'morning'}
            onClick={(e) => { e.stopPropagation(); handleSendMorning(); }}
            title={c.is_samsung_check ? "삼성 체크 건은 문자 발송 제외 대상입니다." : ""}
            className={`flex-none px-2 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-0.5 border transition-all ${
              c.is_samsung_check 
                ? 'bg-gray-100 text-gray-400 border-gray-200 opacity-50 pointer-events-none'
                : (c.is_morning_alert_sent || c.sms_sent_reminder) 
                  ? 'bg-gray-50 text-gray-400 border-gray-200 disabled:opacity-80' 
                  : 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100 active:scale-[0.98] disabled:opacity-80'
            }`}
          >
            <span className="material-symbols-outlined text-[12px]">wb_twilight</span>
            {sendingType === 'morning' ? '처리중' : ((c.is_morning_alert_sent || c.sms_sent_reminder) ? '예약완료' : '아침알림')}
          </button>

          <button onClick={(e) => { e.stopPropagation(); handleEdit(c); }} className="flex-none px-3 py-1.5 rounded-lg text-[11px] font-bold border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all">
            수정
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

  // --- 이미지 워터마크 & 네이티브 압축 로직 (모바일 호환성 100%) ---
  const processImage = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("파일 읽기 실패"));
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.onerror = () => reject(new Error("이미지 로드 실패"));
        img.src = event.target.result;
        img.onload = () => {
          let targetWidth = img.width;
          let targetHeight = img.height;
          
          // 제한 크기 1200px (화질 보전 및 안정적 압축)
          const MAX_SIZE = 1200;
          if (targetWidth > targetHeight) {
            if (targetWidth > MAX_SIZE) {
              targetHeight *= MAX_SIZE / targetWidth;
              targetWidth = MAX_SIZE;
            }
          } else {
            if (targetHeight > MAX_SIZE) {
              targetWidth *= MAX_SIZE / targetHeight;
              targetHeight = MAX_SIZE;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

          // 워터마크 스타일
          const fontSize = Math.max(targetWidth * 0.03, 20);
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.textAlign = 'right';

          const text1 = `Clean Bro | ${businessProfile?.company_name || '클린브로'}`;
          const text2 = getTodayStr();
          ctx.fillText(text1, canvas.width - 20, canvas.height - 45);
          ctx.fillText(text2, canvas.width - 20, canvas.height - 15);

          canvas.toBlob(async (blob) => {
            if (!blob) return reject(new Error("Canvas to Blob 변환 실패"));
            try {
              const arrayBuffer = await blob.arrayBuffer();
              resolve(arrayBuffer);
            } catch (err) {
              reject(new Error("ArrayBuffer 변환 실패: " + err.message));
            }
          }, 'image/jpeg', 0.85); // 0.85 품질 화질 최적화
        };
      };
    });
  };

  // --- 작업 완료 처리 (사진 첨부 없이 빠른 완료 + 메시지앱 열기 + 블로그 모달) ---
  const handleFinalComplete = async (withSms = true) => {
    setIsUploadingPhotos(true);
    try {
      // DB 완료 처리
      const { error: dbErr } = await supabase.from('bookings').update({
        is_completed: true,
      }).eq('id', completionTarget.id);
      if (dbErr) throw dbErr;

      if (withSms) {
        // 완료 안내문구 준비
        let completionText = businessProfile.default_completion_message ||
          `[클린브로] 안녕하세요, 고객님!\n{customer_name}님 {memo} 작업이 완료되었습니다.\n깨끗하게 청소해 드렸으니 확인해 주세요. 감사합니다! 😊`;
        completionText = completionText
          .replace(/{customer_name}/g, completionTarget.customer_name || '고객')
          .replace(/{memo}/g, completionTarget.memo || '')
          .replace(/{after_url}/g, '');

        // 메시지앱 열기 (완료 안내문구 pre-fill)
        const cleanPhone = completionTarget.phone.replace(/[^0-9]/g, '');
        const sep = /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?';
        window.location.href = `sms:${cleanPhone}${sep}body=${encodeURIComponent(completionText)}`;
      }

      setShowCompletionModal(false);
      fetchCustomers();

    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    } finally {
      setIsUploadingPhotos(false);
    }
  };


  const handleSaveProduct = async (e) => {
    e.preventDefault();
    setIsSavingProduct(true);
    try {
      let imageUrl = editingProduct.image_url;

      // 이미지 업로드 로직
      if (productImageFile) {
        const fileExt = productImageFile.name.split('.').pop();
        const fileName = `product_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(fileName, productImageFile, { upsert: true });

        if (uploadError) {
          // products 버킷이 없을 경우를 대비해 logos 버킷 재시도 또는 에러 알림
          console.error('Upload error, checking bucket:', uploadError);
          alert('상품 이미지 업로드 실패. 버킷 권한이나 존재 여부를 확인해주세요.');
          setIsSavingProduct(false);
          return;
        }
        const { data: publicUrlData } = supabase.storage.from('products').getPublicUrl(fileName);
        imageUrl = publicUrlData.publicUrl;
      }

      const productData = {
        ...editingProduct,
        image_url: imageUrl,
        price: parseInt(editingProduct.price.toString().replace(/[^0-9]/g, '') || 0),
        stock: parseInt(editingProduct.stock.toString().replace(/[^0-9]/g, '') || 0)
      };

      if (editingProduct.id) {
        const { error } = await supabase.from('products').update(productData).eq('id', editingProduct.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('products').insert([productData]);
        if (error) throw error;
      }
      setShowProductModal(false);
      setProductImageFile(null);
      fetchProducts();
    } catch (err) {
      alert('상품 저장 중 오류: ' + err.message);
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleDeleteProduct = async (id) => {
    if (window.confirm('정말 삭제하시겠습니까?')) {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) alert('삭제 실패: ' + error.message);
      else fetchProducts();
    }
  };

  // --- 로그인 처리 안되었을 시 화면 출력 ---
  if (!session) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-indigo-900 via-blue-900 to-purple-900">
        <div className="relative z-10 bg-white w-full max-w-sm px-7 pt-7 pb-9 rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] border border-white/20 backdrop-blur-sm">
          <div className="text-center mb-5 pt-1">
            {/* 3D Water Drop Icon */}
            <div className="flex justify-center mb-3">
              <div className="w-14 h-14 relative">
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
            <h2 className="text-[11px] font-black text-blue-900 tracking-[0.1em] uppercase mb-4">
              Cleaning Service All-in-One App
            </h2>

            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight drop-shadow-sm">
              {isRecoveryMode ? '새 비밀번호 설정' : isResetMode ? '비밀번호 재설정' : isLoginMode ? 'Cleanbro 시작하기' : 'Cleanbro 파트너 가입'}
            </h1>
            <p className="text-xs font-medium text-slate-600 mt-1 leading-relaxed">
              {isRecoveryMode
                ? '보안을 위해 새로운 비밀번호를 입력해 주세요.'
                : isResetMode
                  ? '가입하신 이메일 주소를 입력하시면\n비밀번호 재설정 링크를 보내드립니다.'
                  : isLoginMode
                    ? '청소 전문가를 위한 국내 No.1 스마트 파트너\n지금 바로 접속하여 비즈니스를 관리하세요.'
                    : '최찬용 대표님과 함께 성장의 기회를 잡으세요.\n스마트한 일정 관리와 자동 보고서가 시작됩니다.'
              }
            </p>

            {/* 앱 주요 특징 (로그인 모드일 때만 홍보용으로 노출) */}
            {isLoginMode && (
              <div className="mt-5 grid grid-cols-2 gap-2 animate-fade-in">
                <div className="bg-white/60 backdrop-blur-sm p-3 rounded-2xl border border-white shadow-sm flex flex-col items-center text-center">
                  <span className="material-symbols-outlined text-blue-600 mb-1 text-[20px]">calendar_month</span>
                  <p className="text-[10px] font-black text-slate-800">스마트 일정</p>
                </div>
                <div className="bg-white/60 backdrop-blur-sm p-3 rounded-2xl border border-white shadow-sm flex flex-col items-center text-center">
                  <span className="material-symbols-outlined text-indigo-600 mb-1 text-[20px]">assignment_turned_in</span>
                  <p className="text-[10px] font-black text-slate-800">자동 보고서</p>
                </div>
                <div className="bg-white/60 backdrop-blur-sm p-3 rounded-2xl border border-white shadow-sm flex flex-col items-center text-center">
                  <span className="material-symbols-outlined text-amber-600 mb-1 text-[20px]">trending_up</span>
                  <p className="text-[10px] font-black text-slate-800">매출 통계</p>
                </div>
                <div className="bg-white/60 backdrop-blur-sm p-3 rounded-2xl border border-white shadow-sm flex flex-col items-center text-center">
                  <span className="material-symbols-outlined text-green-600 mb-1 text-[20px]">shopping_cart</span>
                  <p className="text-[10px] font-black text-slate-800">프로 샵</p>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleAuth}>
            <div className="space-y-4">
              <div className="relative group">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 group-focus-within:text-blue-600 transition-colors">person</span>
                <input
                  type="email"
                  required
                  value={email}
                  disabled={isRecoveryMode}
                  onChange={e => setEmail(e.target.value)}
                  className={`w-full border-2 border-blue-100 rounded-2xl py-3.5 pl-12 pr-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-[15px] placeholder-slate-400 text-slate-800 transition-all font-semibold ${isRecoveryMode ? 'bg-slate-100 opacity-60' : 'bg-blue-50/30'}`}
                  placeholder="이메일을 입력하세요"
                />
              </div>

              {!isResetMode && (
                <div className="relative group">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 group-focus-within:text-blue-600 transition-colors">lock</span>
                  <input
                    type="password"
                    required
                    value={isRecoveryMode ? newPassword : password}
                    onChange={e => isRecoveryMode ? setNewPassword(e.target.value) : setPassword(e.target.value)}
                    className="w-full border-2 border-blue-100 rounded-2xl py-3.5 pl-12 pr-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-[15px] placeholder-slate-400 text-slate-800 bg-blue-50/30 transition-all font-semibold"
                    placeholder={isRecoveryMode ? "새 비밀번호를 입력하세요" : "비밀번호를 입력하세요"}
                  />
                </div>
              )}

              {isLoginMode && !isResetMode && !isRecoveryMode && (
                <div className="flex justify-between items-center px-1">
                  <a
                    href="https://open.kakao.com/o/g5rleHii"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-primary flex items-center gap-1 hover:underline"
                  >
                    <span className="material-symbols-outlined text-[14px]">chat</span>
                    클린브로 커뮤니티(채팅방)
                  </a>
                  <button
                    type="button"
                    onClick={() => setIsResetMode(true)}
                    className="text-[11px] font-bold text-slate-400 hover:text-blue-600 transition-colors"
                  >
                    비밀번호를 잊으셨나요?
                  </button>
                </div>
              )}

              {!isLoginMode && !isResetMode && !isRecoveryMode && (
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

            <div className="mt-7">
              <button
                disabled={authLoading}
                type="submit"
                className="w-full py-5 rounded-[2rem] bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-lg tracking-wide shadow-2xl shadow-blue-500/40 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.97] transition-all flex items-center justify-center transform"
              >
                {authLoading ? (
                  <span className="material-symbols-outlined animate-spin text-2xl">progress_activity</span>
                ) : (
                  isRecoveryMode ? '비밀번호 변경하기' : isResetMode ? '재설정 메일 보내기' : isLoginMode ? '로그인' : '3초만에 회원가입 완료'
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center pt-3 border-t border-slate-100 flex flex-col gap-3">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-[1.5rem] border border-slate-100 shadow-inner">
              <p className="text-[11px] font-bold text-slate-400 mb-2">
                {isResetMode || isRecoveryMode ? '다시 로그인 화면으로 돌아가시겠습니까?' : isLoginMode ? '클린브로가 처음이신가요?' : '이미 계정이 있으신가요?'}
              </p>
              <button
                onClick={() => {
                  if (isResetMode || isRecoveryMode) {
                    setIsResetMode(false);
                    setIsRecoveryMode(false);
                    setIsLoginMode(true);
                  } else {
                    setIsLoginMode(!isLoginMode);
                  }
                }}
                type="button"
                className="w-full py-3 px-4 rounded-xl bg-white border border-primary/20 text-primary font-black text-sm hover:bg-primary hover:text-white transition-all shadow-sm active:scale-95"
              >
                {isResetMode || isRecoveryMode ? '🔑 로그인으로 이동' : isLoginMode ? '🚀 파트너 회원가입 하기' : '🔑 로그인으로 이동'}
              </button>
            </div>

            {/* 설치 가이드 섹션 */}
            <div className="space-y-2 pt-2">
              <p className="text-[10px] font-black text-slate-400 mb-1">👇 아래 가이드를 눌러 바탕화면에 앱을 만드세요!</p>

              {/* iPhone 가이드 */}
              <div className="overflow-hidden bg-white rounded-2xl border border-slate-100 shadow-sm transition-all">
                <button
                  onClick={() => setActiveInstallGuide(activeInstallGuide === 'iphone' ? null : 'iphone')}
                  className="w-full p-4 flex items-center justify-between font-bold text-slate-700"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="material-symbols-outlined text-blue-500">app_shortcut</span>
                    🍎 아이폰 사용자 설치 가이드
                  </div>
                  <span className="material-symbols-outlined transition-transform" style={{ transform: activeInstallGuide === 'iphone' ? 'rotate(180deg)' : 'none' }}>expand_more</span>
                </button>
                {activeInstallGuide === 'iphone' && (
                  <div className="px-4 pb-6 pt-2 text-left animate-slide-down space-y-4">
                    <div className="bg-blue-50/50 p-4 rounded-xl space-y-3 border border-blue-100/50">
                      <p className="text-xs font-medium text-slate-600 flex items-start gap-2">
                        <span className="bg-white w-5 h-5 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold">1</span>
                        사파리(Safari) 앱으로 접속하세요! 🌐
                      </p>
                      <p className="text-xs font-medium text-slate-600 flex items-start gap-2">
                        <span className="bg-white w-5 h-5 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold">2</span>
                        하단 중앙의 <b>공유 버튼</b> [ ↑ ] 클릭 ⬆️
                      </p>
                      <p className="text-xs font-medium text-slate-600 flex items-start gap-2">
                        <span className="bg-white w-5 h-5 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold">3</span>
                        리스트를 올려 <b>'홈 화면에 추가'</b> [ + ] 선택 ➕
                      </p>
                      <p className="text-xs font-medium text-slate-600 flex items-start gap-2">
                        <span className="bg-white w-5 h-5 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold">4</span>
                        우측 상단 <b>추가</b> 클릭! 바탕화면에 아이콘 생성 ✨
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Android 가이드 */}
              <div className="overflow-hidden bg-white rounded-2xl border border-slate-100 shadow-sm transition-all">
                <button
                  onClick={() => setActiveInstallGuide(activeInstallGuide === 'android' ? null : 'android')}
                  className="w-full p-4 flex items-center justify-between font-bold text-slate-700"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="material-symbols-outlined text-green-500">robot</span>
                    🤖 안드로이드 사용자 가이드
                  </div>
                  <span className="material-symbols-outlined transition-transform" style={{ transform: activeInstallGuide === 'android' ? 'rotate(180deg)' : 'none' }}>expand_more</span>
                </button>
                {activeInstallGuide === 'android' && (
                  <div className="px-4 pb-6 pt-2 text-left animate-slide-down space-y-4">
                    <div className="bg-green-50/50 p-4 rounded-xl space-y-3 border border-green-100/50">
                      <p className="text-xs font-medium text-slate-600 flex items-start gap-2">
                        <span className="bg-white w-5 h-5 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold">1</span>
                        크롬(Chrome) 앱으로 접속하세요! 🌐
                      </p>
                      <p className="text-xs font-medium text-slate-600 flex items-start gap-2">
                        <span className="bg-white w-5 h-5 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold">2</span>
                        우측 상단 <b>메뉴 버튼</b> [ ⋮ ] 클릭 ⋮
                      </p>
                      <p className="text-xs font-medium text-slate-600 flex items-start gap-2">
                        <span className="bg-white w-5 h-5 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold">3</span>
                        <b>'홈 화면에 추가'</b> 또는 <b>'앱 설치'</b> 선택 📲
                      </p>
                      <p className="text-xs font-medium text-slate-600 flex items-start gap-2">
                        <span className="bg-white w-5 h-5 rounded-full flex items-center justify-center shrink-0 border text-[10px] font-bold">4</span>
                        문구 확인 후 <b>추가/설정</b> 클릭 시 완료! ✨
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- 메인 앱 ---
  const userEmail = session?.user?.email || 'user@cleanbro.com';
  const userName = userEmail.split('@')[0];
  const isAdmin = userProfile?.is_admin === true || userEmail === 'ccy6208@naver.com';
  const isCeo = isAdmin || userName.includes('admin') || userName.includes('ceo') || userName.includes('master');
  const roleName = isCeo ? '대표님' : '파트너님';

  return (
    <div className="flex flex-col min-h-screen bg-[#F4F6FA] dark:bg-slate-900 pb-24 text-slate-900 dark:text-slate-100 font-display">

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
          <button onClick={() => setCurrentTab('notice')} className={`transition-colors ${currentTab === 'notice' ? 'text-primary' : 'text-slate-400 hover:text-blue-500'}`}>
            <span className="material-symbols-outlined text-[26px]">campaign</span>
          </button>
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
        <main className="flex-1 max-w-7xl mx-auto w-full flex flex-col gap-3 pt-4 px-4 overflow-x-hidden">

          {/* 최상단: 상세 매출 및 목표 달성 카드 (1단계 고도화 버전) */}
          <div className="max-w-lg mx-auto w-full bg-white dark:bg-slate-800 p-4 sm:p-5 rounded-2xl shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border-0">
            <div className="flex items-center justify-between px-1">
              <div className="cursor-pointer transition-transform active:scale-95 flex-1" onClick={() => setCurrentTab('stats')}>
                <p className="text-[10px] font-bold text-slate-400 mb-0.5 leading-none">
                  {selectedDate === getTodayStr() ? '오늘의 합계 매출' : `${parseInt(selectedDate.split('-')[1], 10)}월 ${parseInt(selectedDate.split('-')[2], 10)}일 합계 매출`}
                </p>
                <div className="text-xl font-black text-slate-800 dark:text-white flex items-baseline truncate">
                  {fmtNum(calcDashboard(selectedDate).total)}<span className="text-[10px] text-slate-400 font-bold ml-0.5">원</span>
                </div>
              </div>

              <div className="h-6 w-[1px] bg-slate-100 dark:bg-slate-700 mx-3"></div>

              <div className="cursor-pointer transition-transform active:scale-95 flex-1 text-right" onClick={() => setCurrentTab('stats')}>
                <p className="text-[10px] font-bold text-slate-400 mb-0.5 leading-none">이번 달 총 매출</p>
                <div className="flex flex-col items-end">
                  <div className="text-xl font-black text-primary flex items-baseline truncate">
                    {fmtNum(revenueStats.monthSales)}<span className="text-[10px] text-slate-400 font-bold ml-0.5">원</span>
                  </div>
                  <div className={`text-[9px] font-bold mt-0 flex items-center gap-0.5 ${revenueStats.growth >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                    {revenueStats.growth >= 0 ? '▲' : '▼'} {Math.abs(revenueStats.growth)}% <span className="text-slate-400 font-medium ml-0.5">전월대비</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 목표 달성 게이지 */}
            <div className="mt-3 pt-3 border-t border-slate-50 dark:border-slate-700">
              <div className="flex justify-between items-center mb-1.5">
                <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-amber-500">military_tech</span>
                  목표 달성률 <span className="text-slate-900 dark:text-white">{revenueStats.achieveRate}%</span>
                </p>
                <button onClick={() => { setNewTargetRevenue(revenueStats.target.toString()); setShowTargetEdit(true); }} className="p-0.5 px-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors text-slate-400 flex items-center">
                  <span className="material-symbols-outlined text-[14px]">settings</span>
                </button>
              </div>
              <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden flex p-0 border border-slate-50">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-out shadow-sm relative ${revenueStats.achieveRate < 50 ? 'bg-orange-500' :
                    revenueStats.achieveRate < 80 ? 'bg-yellow-400' :
                      revenueStats.achieveRate < 100 ? 'bg-green-500' :
                        'bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 animate-pulse'
                    }`}
                  style={{ width: `${revenueStats.achieveRate}%` }}
                >
                </div>
              </div>
              <div className="flex justify-between mt-1.5 px-0.5">
                <span className="text-[9px] text-slate-400 font-bold tracking-tight">이번 달 목표액</span>
                <span className="text-[10px] text-slate-600 font-black">{fmtNum(revenueStats.target)}원</span>
              </div>
            </div>
          </div>

          {/* 캘린더 및 통합 리스트 구역 */}
          <div className={`flex gap-1.5 sm:gap-6 items-start transition-all duration-300 ${!showAllSchedule ? 'justify-center' : ''}`}>
            {/* 왼쪽: 캘린더 */}
            <div className={`bg-white dark:bg-slate-800 p-1.5 sm:p-5 rounded-[1.2rem] sm:rounded-[1.5rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border-0 mb-0 relative transition-all duration-300 ${!showAllSchedule ? 'flex-none w-full max-w-lg' : 'flex-1 min-w-0'}`}>
              <div className="flex justify-between items-center mb-4">
                <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1))} className="p-0.5 text-slate-400 hover:text-primary">
                  <span className="material-symbols-outlined text-base sm:text-xl">chevron_left</span>
                </button>
                <h2 className="font-bold text-xs sm:text-lg">{calDate.getFullYear()}년 {calDate.getMonth() + 1}월</h2>
                <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1))} className="p-0.5 text-slate-400 hover:text-primary">
                  <span className="material-symbols-outlined text-base sm:text-xl">chevron_right</span>
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0 text-center text-[8px] sm:text-xs font-bold text-slate-400 mb-1 sm:mb-2 text-center">
                <div className="text-red-400">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div className="text-blue-400">토</div>
              </div>

              <div className="grid grid-cols-7 gap-1">
                {getCalendarDays().map((dStr, idx) => {
                  if (!dStr) return <div key={`empty-${idx}`} className="h-12 sm:h-16"></div>;

                  const dList = customers.filter(c => c.book_date === dStr);
                  const dObj = new Date(dStr);
                  const isToday = dStr === getTodayStr();
                  const isSelected = dStr === selectedDate;
                  const count = dList.length;
                  const isSunday = idx % 7 === 0;
                  const isSaturday = idx % 7 === 6;
                  const isHoliday = PUBLIC_HOLIDAYS.includes(dStr);
                  
                  let dayTextColor = 'text-slate-700';
                  if (isSunday || isHoliday) dayTextColor = 'text-red-500';
                  else if (isSaturday) dayTextColor = 'text-blue-500';

                  return (
                    <div
                      key={dStr}
                      onClick={() => setSelectedDate(dStr)}
                      className={`h-12 sm:h-16 flex flex-col items-center justify-start pt-1 border relative cursor-pointer transition-all rounded-xl
                        ${isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-transparent hover:bg-gray-50'}
                      `}
                    >
                      <div className={`w-7 h-7 flex items-center justify-center rounded-full text-xs sm:text-sm font-bold transition-colors
                        ${isToday ? 'bg-[#FF5722] text-white shadow-md ring-2 ring-[#FF5722] ring-offset-1' : (isSelected ? 'text-blue-600' : dayTextColor)}
                      `}>
                        {dObj.getDate()}
                      </div>
                      
                      <div className="flex items-center justify-center mt-1 h-4">
                        {count === 1 && (
                          <div className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]"></div>
                        )}
                        {count >= 2 && count <= 3 && (
                          <div className="w-4 h-4 rounded-full bg-[#3B82F6] text-white text-[9px] flex items-center justify-center font-black">
                            {count}
                          </div>
                        )}
                        {count >= 4 && (
                          <div className="w-4 h-4 rounded-full bg-[#1E3A8A] text-white text-[9px] flex items-center justify-center font-black">
                            {count}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 전체 일정 보기 버튼 (상태 연결) */}
              {!showAllSchedule && (
                <button 
                  onClick={() => setShowAllSchedule(true)}
                  className="absolute bottom-4 right-4 z-10 p-2 pl-4 pr-3 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold shadow-md flex items-center gap-1 hover:bg-blue-100 transition-all active:scale-95 animate-fade-in"
                >
                  전체 일정 보기
                  <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                </button>
              )}
            </div>

            {/* 오른쪽: 이달의 전체 리스트 (조건부 렌더링) */}
            {showAllSchedule && (
              <div className="flex-1 bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm border-0 h-[400px] flex flex-col min-w-0 animate-slide-left relative">
                <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300 mb-4 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-blue-600 text-[20px]">calendar_month</span>
                    {calDate.getMonth() + 1}월 전체 일정
                    <span className="text-xs bg-gray-100 dark:bg-slate-700 px-2.5 py-1 rounded-full text-gray-500 font-bold ml-1">{monthlyCalendarList.length}건</span>
                  </span>
                  <button 
                    onClick={() => setShowAllSchedule(false)}
                    className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-slate-400 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </h3>

                <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar">
                  {monthlyCalendarList.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-10">
                      <span className="material-symbols-outlined text-[40px] opacity-20 mb-2">event_busy</span>
                      <p className="text-xs font-bold">일정이 없습니다.</p>
                    </div>
                  ) : (
                    // 날짜별 그룹화 로직
                    Object.entries(
                      monthlyCalendarList.reduce((acc, c) => {
                        if (!acc[c.book_date]) acc[c.book_date] = [];
                        acc[c.book_date].push(c);
                        return acc;
                      }, {})
                    ).sort(([a], [b]) => a.localeCompare(b)).map(([dateStr, items]) => {
                      const d = new Date(dateStr);
                      const weekDay = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
                      return (
                        <div key={dateStr} className="space-y-2">
                          <div className="sticky top-0 bg-white dark:bg-slate-800 z-10 py-1">
                            <p className="text-[11px] font-black text-blue-600/80 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded inline-block">
                              {d.getMonth() + 1}월 {d.getDate()}일 ({weekDay})
                            </p>
                          </div>
                          {items.map(c => {
                            let statusColor = 'bg-blue-500'; // 예정
                            if (c.is_completed) statusColor = 'bg-[#10B981]'; // 완료
                            return (
                              <div
                                key={c.id}
                                onClick={() => {
                                  setSelectedDate(c.book_date);
                                  setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                }}
                                className={`relative flex items-center justify-between p-3 pl-5 ${c.is_samsung_check && !c.is_completed ? 'bg-[#eef2ff] border-[#c7d2fe]' : 'bg-gray-50 border-transparent'} dark:bg-slate-900/50 rounded-xl cursor-pointer hover:bg-gray-100 transition-all border hover:border-gray-200`}
                              >
                                <div className={`absolute left-0 top-3 bottom-3 w-[4px] rounded-r-full ${statusColor}`}></div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                    <p className={`text-xs font-bold truncate ${c.is_completed ? 'text-gray-400' : 'text-slate-800 dark:text-slate-100'}`}>
                                      {c.customer_name || '이름 없음'}
                                    </p>
                                    {c.is_samsung_check && (
                                      <span className="bg-[#4f46e5] text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm">
                                        삼성체크
                                      </span>
                                    )}
                                    {c.memo?.match(/\[(\d+)일의 일정 중 (\d+)일차\]/) && (
                                      <span className="bg-amber-100 text-amber-700 text-[8px] font-black px-1.5 py-0.5 rounded border border-amber-200">
                                        {c.memo.match(/\[(\d+)일의 일정 중 (\d+)일차\]/)[1]}일 일정 ({c.memo.match(/\[(\d+)일의 일정 중 (\d+)일차\]/)[2]}일차)
                                      </span>
                                    )}
                                    {c.is_completed && <span className="material-symbols-outlined text-[#10B981] text-[14px]">check_circle</span>}
                                  </div>
                                  <p className="text-[10px] text-gray-400 font-medium">
                                    {c.book_time_type === '직접입력' ? c.book_time_custom : c.book_time_type} · {c.product}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] font-black text-slate-700">{fmtNum(c.final_price)}원</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 선택된 날짜의 리스트 상세 */}
          <div className="max-w-lg mx-auto w-full pt-4" ref={detailRef}>
            <h3 className="font-bold text-sm text-slate-600 dark:text-slate-400 mb-3 px-1 flex justify-between items-center">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                {selectedDate.split('-')[2]}일 예약 상세 리스트
              </span>
              <div className="flex gap-2 items-center">
                <button onClick={() => handleBulkDeleteDuplicates(selectedDate)} className="text-[10px] bg-red-50 text-red-500 px-2 py-0.5 rounded border border-red-100 hover:bg-red-100 transition-colors font-bold active:scale-95">
                  중복 싹 지우기
                </button>
                <span className="font-normal text-[10px] opacity-70">(길게 눌러 수정/삭제)</span>
              </div>
            </h3>
            {calcDashboard(selectedDate).list.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm bg-white dark:bg-slate-800/50 rounded-[2rem] border-2 border-dashed border-slate-100 dark:border-slate-700 shadow-inner">
                <span className="material-symbols-outlined text-[30px] block mb-2 opacity-20">history_edu</span>
                해당 날짜에 예약이 없습니다.
              </div>
            ) : (
              <div className="space-y-4 pb-12">
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
                <label className="block text-xs font-semibold text-slate-500 mb-1">고객명 / 품목 선택</label>
                <div className="relative">
                  <input
                    type="text"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="이름 입력 (또는 우측 ▼ 클릭하여 카테고리 선택)"
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 rounded-xl p-3 pr-10 text-sm focus:ring-2 focus:ring-primary outline-none"
                    list="category-presets"
                  />
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">arrow_drop_down</span>
                  <datalist id="category-presets">
                    {Object.entries(CATEGORIES).map(([cat, prods]) => (
                      <optgroup key={cat} label={cat}>
                        <option value={cat}>{cat}</option>
                        {prods.map(p => <option key={`${cat}-${p}`} value={`${cat} (${p})`}>{cat} ({p})</option>)}
                      </optgroup>
                    ))}
                  </datalist>
                </div>
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

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">서비스 카테고리 (썸네일용)</label>
                  <select value={serviceType} onChange={e => setServiceType(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none">
                    <option value="에어컨">에어컨</option>
                    <option value="세탁기">세탁기</option>
                    <option value="인스턴티">인스턴티</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">상세 모델명 (썸네일용)</label>
                  <input type="text" value={modelName} onChange={e => setModelName(e.target.value)} placeholder="예: 무풍 2구 스탠드" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
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

              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-sm font-bold text-slate-800 dark:text-slate-200">삼성 체크 (문자 발송 제외)</span>
                    {isSamsungCheck && <span className="text-xs font-bold text-red-500">문자 발송이 비활성화되었습니다</span>}
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={isSamsungCheck} onChange={e => setIsSamsungCheck(e.target.checked)} />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
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
                  <div className="flex gap-1 mt-1.5">
                    <button type="button" onClick={() => { const d = new Date(); setBookDate(d.toISOString().split('T')[0]); }} className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-[10px] rounded border border-slate-200 text-slate-600 font-bold transition-colors active:scale-95">오늘</button>
                    <button type="button" onClick={() => { const d = new Date(); d.setDate(d.getDate()+1); setBookDate(d.toISOString().split('T')[0]); }} className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-[10px] rounded border border-slate-200 text-slate-600 font-bold transition-colors active:scale-95">내일</button>
                    <button type="button" onClick={() => { const d = new Date(); d.setDate(d.getDate()+2); setBookDate(d.toISOString().split('T')[0]); }} className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-[10px] rounded border border-slate-200 text-slate-600 font-bold transition-colors active:scale-95">+2일</button>
                    <button type="button" onClick={() => { const d = new Date(); d.setDate(d.getDate()+3); setBookDate(d.toISOString().split('T')[0]); }} className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-[10px] rounded border border-slate-200 text-slate-600 font-bold transition-colors active:scale-95">+3일</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">방문 시간대</label>
                  <select value={bookTimeType} onChange={e => setBookTimeType(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2">
                    {Array.from({ length: 36 }, (_, i) => {
                      const hour = Math.floor(i / 2) + 5;
                      const minute = i % 2 === 0 ? '00' : '30';
                      const timeStr = `${String(hour).padStart(2, '0')}:${minute}`;
                      return <option key={timeStr} value={timeStr}>{timeStr}</option>;
                    })}
                    <option value="직접입력">직접 입력 (분 단위 등)</option>
                  </select>
                </div>
              </div>

              <div className="animate-slide-up">
                <label className="block text-xs font-semibold text-slate-500 mb-1">작업 소요 기간 (종료일 설정)</label>
                <div className="flex gap-2 items-center">
                  <input type="date" value={bookDate} disabled className="flex-1 bg-slate-100 border border-slate-200 rounded-xl p-3 text-sm text-slate-500 cursor-not-allowed font-bold" />
                  <span className="text-slate-400 font-black">~</span>
                  <input type="date" value={endDate} min={bookDate} onChange={e => {
                    const sel = e.target.value;
                    if (!sel) {
                      setEndDate('');
                      return;
                    }
                    if (!bookDate) {
                      setEndDate(sel);
                      return;
                    }
                    const sDate = new Date(bookDate);
                    const eDate = new Date(sel);
                    sDate.setHours(0,0,0,0);
                    eDate.setHours(0,0,0,0);
                    
                    if (eDate >= sDate) {
                      setEndDate(sel);
                    } else {
                      alert('종료일이 시작일보다 빠를 수 없어, 시작일로 자동 맞춰집니다.');
                      setEndDate(bookDate);
                    }
                  }} className="flex-1 bg-white border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary outline-none" />
                </div>
                {endDate && endDate >= bookDate && (
                  <p className="text-[10px] text-blue-500 font-bold mt-1.5 ml-1">
                    ※ {bookDate} 부터 {endDate} 까지 연속으로 달력에 자동 등록됩니다. (매출액은 첫 날에만 합산)
                  </p>
                )}
                {(!endDate || endDate < bookDate) && (
                  <p className="text-[10px] text-slate-400 font-bold mt-1.5 ml-1">
                    ※ 종료일을 비워두시면 {bookDate} 당일 단일 예약으로 자동 처리됩니다.
                  </p>
                )}
              </div>

              {bookTimeType === '직접입력' && (
                <div className="animate-slide-up">
                  <input type="text" placeholder="예: 오전 10시 30분경" value={bookTimeCustom} onChange={e => setBookTimeCustom(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2" />
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
                    {[...new Set([myNickname, ...(teamMembers || []).map(m => m.nickname)])].filter(Boolean).map(nickname => (
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
          <button 
            onClick={handleSaveBooking} 
            disabled={isSavingBooking}
            className={`w-full py-4 text-white text-lg font-black rounded-2xl shadow-lg flex justify-center gap-2 items-center transition-all ${
              isSavingBooking ? 'bg-slate-400 shadow-none cursor-not-allowed' : 'bg-primary shadow-primary/30 active:scale-95'
            }`}
          >
            {isSavingBooking ? (
              <>
                <span className="material-symbols-outlined animate-spin inline-block">sync</span>
                <span className="animate-pulse">안전하게 저장 중...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">cloud_upload</span>
                {editingId ? '클라우드에 예약 수정 완료' : '클라우드에 예약 저장하기'}
              </>
            )}
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
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-5 animate-slide-up pb-32">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">settings</span> 설정
            </h2>
            {settingsActiveMenu !== 'main' && (
              <button
                onClick={() => setSettingsActiveMenu('main')}
                className="flex items-center gap-1 text-sm font-bold text-slate-500 bg-white px-3 py-1.5 rounded-xl border shadow-sm active:scale-95"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span> 메뉴로
              </button>
            )}
          </div>

          {/* --- 설정 메인 메뉴 --- */}
          {settingsActiveMenu === 'main' && (
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => setSettingsActiveMenu('profile')}
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 active:scale-95 transition-all text-left group"
              >
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined">storefront</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-800 dark:text-slate-100">업체 프로필 설정</h4>
                  <p className="text-xs text-slate-400">업체명, 로고, 대표번호 관리</p>
                </div>
                <span className="material-symbols-outlined text-slate-300">chevron_right</span>
              </button>

              <button
                onClick={() => setSettingsActiveMenu('message_settings')}
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 active:scale-95 transition-all text-left group"
              >
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined">forum</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-800 dark:text-slate-100">메시지 발송 및 템플릿 관리</h4>
                  <p className="text-xs text-slate-400">자동 문자, 완료 메시지 및 솔라피 연동</p>
                </div>
                <span className="material-symbols-outlined text-slate-300">chevron_right</span>
              </button>

              {isAdmin && (
                <>
                  <button
                    onClick={() => {
                      setShowBatchBlogModal(true);
                      // 모달 띄울 때 대기열 현황도 불러오기 
                    }}
                    className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-orange-100 dark:border-slate-700 flex items-center gap-4 active:scale-95 transition-all text-left group"
                  >
                    <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-colors">
                      <span className="material-symbols-outlined">auto_schedule</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-slate-800 dark:text-slate-100">AI 블로그 5슬롯 예약 발행</h4>
                      <p className="text-xs text-orange-500 font-medium overflow-hidden whitespace-nowrap text-ellipsis max-w-[200px] sm:max-w-none">12~24시간 간격으로 네이버 블로그 자동 예약 발행</p>
                    </div>
                    <span className="material-symbols-outlined text-slate-300">chevron_right</span>
                  </button>
                </>
              )}

              {isAdmin && (
                <>
                  <button
                    onClick={() => setSettingsActiveMenu('ai_meeting')}
                    className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-orange-100 dark:border-slate-700 flex items-center gap-4 active:scale-95 transition-all text-left group"
                  >
                    <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors">
                      <span className="material-symbols-outlined">psychology_alt</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-slate-800 dark:text-slate-100">AI 블로그 오답 노트 (전략 회의)</h4>
                      <p className="text-xs text-purple-500 font-medium overflow-hidden whitespace-nowrap text-ellipsis">성과 저조 원인을 분석하고 다음 포스팅 퀄리티 업그레이드</p>
                    </div>
                    <span className="material-symbols-outlined text-slate-300">chevron_right</span>
                  </button>
                </>
              )}

              <button
                onClick={() => setSettingsActiveMenu('invite')}
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 active:scale-95 transition-all text-left group"
              >
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined">group_add</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-800 dark:text-slate-100">파트너 초대 관리</h4>
                  <p className="text-xs text-slate-400">초대 코드 및 링크 발송</p>
                </div>
                <span className="material-symbols-outlined text-slate-300">chevron_right</span>
              </button>

              <button
                onClick={() => setCurrentTab('notice')}
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 active:scale-95 transition-all text-left group"
              >
                <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center group-hover:bg-rose-600 group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined">campaign</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-800 dark:text-slate-100">공지사항 및 가이드</h4>
                  <p className="text-xs text-slate-400">앱 사용 설명서 및 최신 업데이트 확인</p>
                </div>
                <span className="material-symbols-outlined text-slate-300">chevron_right</span>
              </button>

              {/* 바이럴 쇼츠 AI 기능 추가 */}
              {isAdmin && (
                <button
                  onClick={() => setSettingsActiveMenu('shorts_ai')}
                  className="bg-gradient-to-br from-purple-500 to-fuchsia-600 p-5 rounded-2xl shadow-lg border-0 flex items-center gap-4 active:scale-95 transition-all text-left group"
                >
                  <div className="w-12 h-12 bg-white/20 text-white rounded-xl flex items-center justify-center backdrop-blur-sm">
                    <span className="material-symbols-outlined">movie</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-black text-white">쇼츠 AI 대시보드</h4>
                    <p className="text-xs text-purple-100 font-medium">바이럴 숏폼 제작 자동화</p>
                  </div>
                  <span className="material-symbols-outlined text-white/50">chevron_right</span>
                </button>
              )}

              <a
                href="https://open.kakao.com/o/g5rleHii"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 active:scale-95 transition-all text-left group"
              >
                <div className="w-12 h-12 bg-yellow-50 text-yellow-600 rounded-xl flex items-center justify-center group-hover:bg-yellow-400 group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined">forum</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-800 dark:text-slate-100">클린브로 커뮤니티(오픈채팅)</h4>
                  <p className="text-xs text-slate-400">대표님들과 소통하고 정보를 나누세요</p>
                </div>
                <span className="material-symbols-outlined text-slate-300">open_in_new</span>
              </a>

              {isCeo && (
                <button
                  onClick={() => setSettingsActiveMenu('bulk')}
                  className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center gap-4 active:scale-95 transition-all text-left group"
                >
                  <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center group-hover:bg-red-600 group-hover:text-white transition-colors">
                    <span className="material-symbols-outlined">rule_folder</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-800 dark:text-slate-100">데이터 일괄 변경 (관리자)</h4>
                    <p className="text-xs text-slate-400">과세 유형 일괄 업데이트</p>
                  </div>
                  <span className="material-symbols-outlined text-slate-300">chevron_right</span>
                </button>
              )}

              <div className="pt-6">
                <button
                  onClick={handleLogout}
                  className="w-full py-4 bg-red-50 text-red-600 font-bold rounded-2xl active:scale-95 transition-all flex justify-center items-center gap-2 border border-red-100 shadow-sm"
                >
                  <span className="material-symbols-outlined">logout</span> 로그아웃
                </button>
              </div>
            </div>
          )}

          {/* --- 상세 메뉴 1: 업체 프로필 설정 --- */}
          {settingsActiveMenu === 'profile' && (
            <form onSubmit={handleSaveProfile} className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-5 animate-slide-up">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">업체명</label>
                <input type="text" required value={editCompanyName} onChange={e => setEditCompanyName(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-primary" placeholder="업체명 입력" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">내 닉네임 (작업 담당자 노출용)</label>
                <input type="text" required value={editNickname} onChange={e => setEditNickname(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-primary" placeholder="예: 구로구점 김길동, 마스터" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">개인 연락처 (선택, 팀원 상호 노출용)</label>
                <input type="tel" value={editPersonalPhone} onChange={e => setEditPersonalPhone(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-primary" placeholder="예: 010-0000-0000" />
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
                <input type="tel" value={editBusinessPhone} onChange={e => setEditBusinessPhone(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-primary" placeholder="예: 010-0000-0000" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">업체 자체 로고 업로드</label>
                {businessProfile.logo_url && (
                  <div className="mb-3">
                    <img src={businessProfile.logo_url} alt="Logo" className="w-20 h-20 object-contain rounded-lg border bg-slate-50" />
                  </div>
                )}
                <input type="file" accept="image/*" onChange={e => setEditLogoFile(e.target.files[0])} className="w-full p-2 text-sm border rounded-xl" />
              </div>
              <button disabled={isSavingSettings} type="submit" className="w-full py-4 bg-primary text-white text-lg font-black rounded-xl shadow-lg active:scale-95 transition-transform">
                {isSavingSettings ? '업데이트 중...' : '프로필 정보 업데이트'}
              </button>
            </form>
          )}

          {/* --- 상세 메뉴 2: 메시지 및 템플릿 통합 설정 --- */}
          {settingsActiveMenu === 'message_settings' && (
            <div className="space-y-6 animate-slide-up">
              {/* 서브 탭 카테고리 버튼 */}
              <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                <button
                  onClick={() => setSettingsMsgSubTab('completion')}
                  className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${settingsMsgSubTab === 'completion' ? 'bg-white dark:bg-slate-700 text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <span className="material-symbols-outlined text-sm">task_alt</span> 작업 완료 보고
                </button>
                <button
                  onClick={() => setSettingsMsgSubTab('auto_sms')}
                  className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${settingsMsgSubTab === 'auto_sms' ? 'bg-white dark:bg-slate-700 text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <span className="material-symbols-outlined text-sm">auto_mode</span> 자동문자/솔라피
                </button>
              </div>

              {settingsMsgSubTab === 'completion' && (
                <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-6 animate-fade-in">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">작업 완료 보고 메시지 템플릿</label>
                    <textarea value={editDefaultMessage} onChange={e => setEditDefaultMessage(e.target.value)} className="w-full h-40 p-4 text-sm bg-slate-50 dark:bg-slate-900 border rounded-xl focus:ring-2 focus:ring-primary outline-none" />
                    <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                      * 사용 가능 치환자 : <b>{"{customer_name}"}</b>, <b>{"{memo}"}</b>, <b>{"{after_url}"}</b>
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-center border-t pt-4 border-slate-50">
                    <div className="space-y-2">
                      <label className="block text-[10px] font-bold text-slate-500">❄️ 에어컨 관리 가이드</label>
                      {businessProfile.ac_guide_url && <img src={businessProfile.ac_guide_url} className="w-full h-24 object-cover rounded-lg border shadow-sm" />}
                      <input type="file" accept="image/*" onChange={e => setEditAcGuideFile(e.target.files[0])} className="w-full text-[9px]" />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[10px] font-bold text-slate-500">🧺 세탁기 관리 가이드</label>
                      {businessProfile.washer_guide_url && <img src={businessProfile.washer_guide_url} className="w-full h-24 object-cover rounded-lg border shadow-sm" />}
                      <input type="file" accept="image/*" onChange={e => setEditWasherGuideFile(e.target.files[0])} className="w-full text-[9px]" />
                    </div>
                  </div>
                  <button onClick={handleSaveProfile} disabled={isSavingSettings} className="w-full py-4 bg-primary text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined">save</span>
                    {isSavingSettings ? '저장 중...' : '메시지 및 가이드 설정 저장'}
                  </button>
                </div>
              )}

              {settingsMsgSubTab === 'auto_sms' && (
                <div className="space-y-5 animate-fade-in">
                  <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-4">
                    <h3 className="text-sm font-black text-primary flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">notifications_active</span> 발송 템플릿 설정
                    </h3>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">예약 확정 자동 문자 (치환자: [고객명], [일시], [시간], [파트너전화번호])</label>
                      <textarea value={editConfirmedTemplate} onChange={e => setEditConfirmedTemplate(e.target.value)} className="w-full h-20 p-3 text-xs bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-primary/30 transition-all font-medium" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">당일 아침 8시 자동 알림</label>
                      <textarea value={editMorningReminderTemplate} onChange={e => setEditMorningReminderTemplate(e.target.value)} className="w-full h-20 p-3 text-xs bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-primary/30 transition-all font-medium" />
                    </div>
                    <div className="flex flex-col gap-2 mt-4">
                      <label className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors">
                        <div>
                          <span className="text-xs font-black text-slate-700 flex items-center gap-1"><span className="material-symbols-outlined text-sm text-blue-500">flash_on</span> 예약 즉시 자동 확정 문자</span>
                          <p className="text-[9px] text-slate-400 font-bold mt-0.5">새로운 예약 등록 시 고객에게 바로 문자를 보냅니다.</p>
                        </div>
                        <input type="checkbox" checked={editAutoConfirmSms} onChange={e => setEditAutoConfirmSms(e.target.checked)} className="w-5 h-5 accent-primary rounded-lg" />
                      </label>
                      <label className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors">
                        <div>
                          <span className="text-xs font-black text-slate-700 flex items-center gap-1"><span className="material-symbols-outlined text-sm text-orange-500">alarm</span> 당일 아침 8시 자동 알림 발송</span>
                          <p className="text-[9px] text-slate-400 font-bold mt-0.5">당일 작업 대상자에게 아침 8시에 알림을 보냅니다.</p>
                        </div>
                        <input type="checkbox" checked={editAutoMorningReminders} onChange={e => setEditAutoMorningReminders(e.target.checked)} className="w-5 h-5 accent-primary rounded-lg" />
                      </label>
                      <label className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors">
                        <div>
                          <span className="text-xs font-black text-slate-700 flex items-center gap-1"><span className="material-symbols-outlined text-sm text-green-500">group</span> 파트너 예약 동기화 알림</span>
                          <p className="text-[9px] text-slate-400 font-bold mt-0.5">새 예약 등록 시 팀원(파트너)들에게 자동으로 알림을 보냅니다.</p>
                        </div>
                        <input type="checkbox" checked={editAutoPartnerSms} onChange={e => setEditAutoPartnerSms(e.target.checked)} className="w-5 h-5 accent-primary rounded-lg" />
                      </label>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-black text-slate-700 dark:text-slate-100 flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">api</span> 솔라피 연동 (API)
                      </h3>
                      {solapiBalance !== null && <span className="text-[10px] font-black bg-primary text-white px-2 py-0.5 rounded-full shadow-sm">잔액: {fmtNum(solapiBalance)}원</span>}
                    </div>
                    <div className="space-y-3">
                      <input type="password" value={editSolapiApiKey} onChange={e => setEditSolapiApiKey(e.target.value)} className="w-full p-4 rounded-xl border-2 border-slate-100 bg-slate-50 focus:border-primary transition-all text-xs" placeholder="솔라피 API Key" />
                      <input type="password" value={editSolapiApiSecret} onChange={e => setEditSolapiApiSecret(e.target.value)} className="w-full p-4 rounded-xl border-2 border-slate-100 bg-slate-50 focus:border-primary transition-all text-xs" placeholder="솔라피 API Secret" />
                      <input type="text" value={editSolapiFromNumber} onChange={e => setEditSolapiFromNumber(e.target.value)} className="w-full p-4 rounded-xl border-2 border-slate-100 bg-slate-50 focus:border-primary transition-all text-xs" placeholder="발신인 번호 (010...)" />
                    </div>
                    <div className="flex gap-2 border-t pt-4 border-slate-50">
                      <button onClick={handleSaveProfile} disabled={isSavingSettings} className="flex-[2] py-4 bg-slate-800 text-white font-black rounded-xl active:scale-95 transition-all text-sm shadow-md">
                        {isSavingSettings ? '저장 중...' : '설정 저장'}
                      </button>
                      <button onClick={handleTestSms} disabled={isTestingSms} className="flex-1 py-4 bg-blue-50 text-blue-600 border-2 border-blue-100 font-black rounded-xl active:scale-95 transition-all text-sm shadow-sm flex items-center justify-center gap-1">
                        {isTestingSms ? <span className="material-symbols-outlined animate-spin text-sm">sync</span> : <span className="material-symbols-outlined text-sm">send</span>}
                        테스트
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* --- 상세 메뉴 3.5: AI 오답 노트 (전략 회의) --- */}
          {settingsActiveMenu === 'ai_meeting' && (
            <div className="space-y-6 animate-slide-up">
              <div className="bg-gradient-to-br from-purple-800 to-indigo-900 rounded-[2rem] p-7 shadow-xl relative overflow-hidden text-white">
                <span className="material-symbols-outlined absolute -right-6 -top-6 text-[120px] text-white/5 rotate-12">psychology</span>
                <div className="relative z-10">
                  <span className="inline-block px-2.5 py-1 bg-white/20 rounded-full text-[10px] font-black tracking-widest mb-3 backdrop-blur-sm">AI MASTER AI</span>
                  <h3 className="font-black text-2xl leading-tight mb-2">블로그 조회수가<br/>떨어졌나요?</h3>
                  <p className="text-xs text-white/70 font-medium leading-relaxed">
                    최고의 마케터, 카피라이터, 데이터 분석가 AI 로 구성된<br/>
                    가상의 전략팀을 소집하여 원인을 분석하고,<br/>
                    다음 블로그 자동 발행 시 적용될 핵심 지침을 도출합니다.
                  </p>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-[2rem] p-6 border-0 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-5">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2">어떤 점이 문제인가요?</label>
                  <textarea
                    value={aiMeetingIssue}
                    onChange={e => setAiMeetingIssue(e.target.value)}
                    placeholder="(예: 조회수가 10회 미만으로 저조함, 검색 노출이 전혀 안 됨, 이탈률이 높음 등)"
                    className="w-full h-24 p-4 text-sm bg-slate-50 dark:bg-slate-900 border rounded-2xl focus:ring-2 focus:ring-purple-500 outline-none resize-none transition-all"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-2">대상 브랜드 / 카테고리</label>
                  <select
                    value={aiMeetingCategory}
                    onChange={e => setAiMeetingCategory(e.target.value)}
                    className="w-full p-4 text-sm bg-slate-50 dark:bg-slate-900 border rounded-2xl focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                  >
                    <option value="인스턴티">인스턴티 (InstanT)</option>
                    <option value="에어컨">에어컨 청소</option>
                    <option value="세탁기">세탁기 청소</option>
                    <option value="입주/이사">입주/이사 청소</option>
                  </select>
                </div>

                <button
                  onClick={handleGenerateAiMeeting}
                  disabled={isGeneratingMeeting}
                  className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white font-black rounded-2xl shadow-lg shadow-purple-600/30 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isGeneratingMeeting ? (
                    <><span className="material-symbols-outlined animate-spin">sync</span> 회의 진행 중...</>
                  ) : (
                    <><span className="material-symbols-outlined">forum</span> AI 전략 회의 소집하기</>
                  )}
                </button>
              </div>

              {aiGuidelines && (
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-[2rem] p-6 border border-purple-100 dark:border-purple-800/50 space-y-4 animate-fade-in shadow-inner">
                  <h4 className="font-black text-purple-800 dark:text-purple-300 flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-600 dark:text-purple-400">verified</span>
                    도출된 업그레이드 가이드라인
                  </h4>
                  <p className="text-[10px] text-purple-600/70 font-bold mb-2">이 지침은 다음 [블로그 예약 발행] 생성 시 AI 에디터에게 전달됩니다.</p>
                  <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-purple-100 dark:border-purple-700/50 text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300 font-medium shadow-sm">
                    {aiGuidelines}
                  </div>
                  <button
                    onClick={() => {
                       if (window.confirm("가이드라인을 초기화하시겠습니까? (이후 발행글은 기본 지침으로 작성됩니다)")) {
                           setAiGuidelines('');
                           localStorage.removeItem('ai_blog_guidelines');
                       }
                    }}
                    className="w-full py-3 bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-bold text-xs rounded-xl border hover:bg-slate-50 transition-colors"
                  >
                    목표 달성 완료 (초기화)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* --- 상세 메뉴 4: 초대 관리 --- */}
          {settingsActiveMenu === 'invite' && (
            <div className="space-y-6 animate-slide-up">
              {/* 커스텀 초대코드 설정 및 조회 */}
              <div className="bg-white dark:bg-slate-800 rounded-[2rem] p-7 border-0 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.08)] space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center">
                    <span className="material-symbols-outlined">badge</span>
                  </div>
                  <div>
                    <h3 className="font-black text-slate-800 dark:text-white">나만의 브랜드 초대코드</h3>
                    <p className="text-[10px] font-bold text-slate-400">UUID 대신 기억하기 쉬운 코드를 만드세요</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="text"
                      value={editCustomInviteCode}
                      onChange={e => setEditCustomInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      placeholder="예: CLEAN123"
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xl text-primary tracking-widest outline-none focus:border-primary transition-all pr-24"
                    />
                    <button
                      onClick={handleSaveProfile}
                      className="absolute right-2 top-2 bottom-2 px-4 bg-slate-800 text-white text-[11px] font-bold rounded-xl active:scale-95 transition-all"
                    >
                      변경/저장
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-400 px-1">* 영문 대문자와 숫자만 사용 가능합니다.</p>
                </div>
              </div>

              {/* 초대 유형 선택 카드 */}
              <div className="grid grid-cols-1 gap-4">
                {/* 1. 파트너 전용 (내 업체로 합류) */}
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[2rem] p-6 text-white shadow-xl shadow-blue-500/20 relative overflow-hidden group">
                  <span className="material-symbols-outlined absolute -right-4 -bottom-4 text-[100px] opacity-10 group-hover:scale-110 transition-transform">group_add</span>
                  <div className="relative z-10">
                    <span className="inline-block px-2 py-0.5 bg-white/20 rounded-full text-[9px] font-bold mb-2">FOR PARTNERS</span>
                    <h4 className="text-lg font-black mb-1">우리 업체 팀원 초대하기</h4>
                    <p className="text-[11px] text-white/70 font-medium mb-5">직원이나 파트너 사장님이 내 예약 리스트를 함께<br />보고 관리할 수 있게 초대합니다.</p>

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const code = editCustomInviteCode || myBusinessId;
                          const inviteLink = `https://cleanbro-app.vercel.app/?signup&code=${code}`;
                          const msg = `[클린브로 파트너 초대] 🤝\n${businessProfile.company_name}에서 함께 일할 파트너님을 모십니다!\n\n🔗 가입링크: ${inviteLink}\n🔑 초대코드: ${code}\n\n지금 바로 접속하여 일정을 공유받으세요!`;
                          navigator.clipboard.writeText(msg).then(() => alert('파트너 초대장이 복사되었습니다!'));
                        }}
                        className="flex-1 py-3 bg-white text-blue-600 font-bold rounded-xl text-xs active:scale-95 transition-all shadow-sm"
                      >
                        초대 메시지 복사
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. 신규 사장님 추천 (앱 홍보용) */}
                <div className="bg-white dark:bg-slate-800 rounded-[2rem] p-6 border border-slate-100 dark:border-slate-700 shadow-lg group relative overflow-hidden">
                  <span className="material-symbols-outlined absolute -right-4 -bottom-4 text-[100px] text-slate-50 dark:text-slate-800 group-hover:scale-110 transition-transform">rocket_launch</span>
                  <div className="relative z-10">
                    <span className="inline-block px-2 py-0.5 bg-primary/10 text-primary rounded-full text-[9px] font-bold mb-2">FOR NEW OWNERS</span>
                    <h4 className="text-lg font-black text-slate-800 dark:text-white mb-1">다른 사장님께 클린브로 추천하기</h4>
                    <p className="text-[11px] text-slate-400 font-medium mb-5">독립적인 비즈니스를 운영하는 주변 사장님들께<br />최고의 일정 관리 앱을 홍보해 보세요!</p>

                    <button
                      onClick={() => {
                        const msg = `[클린브로 추천] 🌟\n청소 업체 사장님들을 위한 최고의 파트너 앱!\n스마트한 일정 관리, 사진 한 장으로 끝나는 작업 보고서까지.\n\n지금 클린브로를 시작하고 비즈니스를 업그레이드 하세요!\n\n🔗 앱 구경하기: https://cleanbro-app.vercel.app\n(추천인: ${businessProfile.company_name})`;
                        if (navigator.share) navigator.share({ title: '클린브로 앱 추천', text: msg, url: 'https://cleanbro-app.vercel.app' });
                        else {
                          navigator.clipboard.writeText(msg).then(() => alert('추천 메시지가 복사되었습니다! 카톡에 공유해 보세요.'));
                        }
                      }}
                      className="w-full py-3.5 bg-slate-800 text-white font-bold rounded-xl text-sm active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[18px]">share</span> 앱 홍보하기 (카톡/공유)
                    </button>
                  </div>
                </div>
              </div>

              {/* 팀 멤버 관리 리스트 */}
              <div className="bg-white dark:bg-slate-800 rounded-[2rem] p-6 border-0 shadow-sm space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h4 className="text-sm font-black text-slate-700 dark:text-white flex items-center gap-1">
                    <span className="material-symbols-outlined text-[18px]">groups</span> 현재 합류한 팀원 ({(teamMembers || []).length})
                  </h4>
                </div>
                <div className="divide-y divide-slate-50 dark:divide-slate-700">
                  {(teamMembers || []).map(member => (
                    <div key={member.id} className="py-3 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center font-bold text-xs text-uppercase">
                          {(member.nickname || 'P').substring(0, 1).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-800 dark:text-white">{member.nickname || '파트너'}</p>
                          <p className="text-[9px] text-slate-400">
                            전화: {(member.solapi_from_number || member.sender_number) ? (
                              <a href={`tel:${(member.solapi_from_number || member.sender_number).replace(/[^0-9]/g, '')}`} className="hover:text-primary transition-colors hover:underline">
                                {(member.solapi_from_number || member.sender_number).replace(/^(\d{2,3})(\d{3,4})(\d{4})$/, `$1-$2-$3`)}
                              </a>
                            ) : '미등록'}
                          </p>
                        </div>
                      </div>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${member.user_role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {member.user_role === 'admin' ? '대표' : '파트너'}
                      </span>
                    </div>
                  ))}
                  {(!teamMembers || teamMembers.length === 0) && <p className="text-center text-[10px] text-slate-400 py-4 italic">아직 합류한 팀원이 없습니다.</p>}
                </div>
              </div>
            </div>
          )}

          {/* --- 상세 메뉴 5: 일괄 변경 (CEO 전용) --- */}
          {settingsActiveMenu === 'bulk' && isCeo && (
            <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-[1.5rem] border border-red-100 dark:border-red-900/30 space-y-5 animate-slide-up">
              <h4 className="font-bold text-red-600 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">warning</span> 데이터 일괄 변경
              </h4>
              <p className="text-[10px] text-red-400 leading-tight">선택한 기간 내의 모든 매출/지출 데이터의 과세 유형을 일괄 업데이트합니다. 이 작업은 되돌릴 수 없습니다.</p>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" value={bulkStartDate} onChange={e => setBulkStartDate(e.target.value)} className="w-full text-xs p-2.5 rounded-xl border bg-white" />
                <input type="date" value={bulkEndDate} onChange={e => setBulkEndDate(e.target.value)} className="w-full text-xs p-2.5 rounded-xl border bg-white" />
              </div>
              <select value={bulkTaxType} onChange={e => setBulkTaxType(e.target.value)} className="w-full text-xs p-3 rounded-xl border bg-white font-bold">
                <option value="간이과세자">간이과세자</option>
                <option value="일반과세자">일반과세자</option>
              </select>
              <button disabled={isBulking} onClick={handleBulkTaxUpdate} className="w-full py-4 bg-red-600 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all">
                {isBulking ? '적용 중...' : '데이터 일괄 적용하기'}
              </button>
            </div>
          )}

          {/* --- [추가] 상세 메뉴 6: 쇼츠 AI 대시보드 --- */}
          {settingsActiveMenu === 'shorts_ai' && (
            <div className="space-y-5 animate-slide-up pb-20">
              <style>{`
                @keyframes pulse-ring { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
              `}</style>

              {/* Header section matching Stitch design conceptually */}
              <div className="bg-slate-900 rounded-[2rem] p-6 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500 rounded-full blur-[80px] opacity-30 -mr-20 -mt-20"></div>
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-fuchsia-600 rounded-full blur-[60px] opacity-20 -ml-10 -mb-10"></div>

                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold tracking-wider uppercase text-purple-200 border border-white/10 backdrop-blur-md">VIRAL SHORTS MAKER</span>
                    <button onClick={() => { setSettingsActiveMenu('main'); setShortsView('home'); }} className="material-symbols-outlined text-white/40 hover:text-white bg-slate-800 p-1.5 rounded-full text-sm">close</button>
                  </div>

                  <div>
                    <h2 className="text-3xl font-black mb-2 tracking-tight">쇼츠 AI<br />대시보드</h2>
                    <p className="text-sm text-slate-300 font-medium leading-relaxed opacity-90">
                      어떤 아이디어든 고성능 세로형 콘텐츠로<br />버튼 한 번에 변환하세요.
                    </p>
                  </div>

                  {shortsView === 'home' && (
                    <div className="pt-4 grid grid-cols-2 gap-3">
                      <button onClick={() => setShortsView('create')} className="bg-white text-slate-900 font-black py-4 px-4 rounded-2xl flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all shadow-lg hover:bg-slate-50">
                        <span className="material-symbols-outlined text-2xl text-purple-600">add_circle</span>
                        <span className="text-[13px]">새로 제작</span>
                      </button>
                      <button className="bg-white/10 text-white font-bold py-4 px-4 rounded-2xl flex flex-col items-center justify-center gap-1.5 backdrop-blur-md border border-white/10 active:scale-95 transition-all hover:bg-white/20">
                        <span className="material-symbols-outlined text-2xl">folder_copy</span>
                        <span className="text-[13px]">라이브러리</span>
                      </button>
                      <button className="col-span-2 bg-white/10 text-white font-bold py-4 px-4 rounded-2xl flex flex-col items-center justify-center gap-1.5 backdrop-blur-md border border-white/10 active:scale-95 transition-all hover:bg-white/20">
                        <span className="material-symbols-outlined text-2xl">analytics</span>
                        <span className="text-[13px]">분석</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {shortsView === 'home' && (
                <>
                  {/* 장면 미리보기 (Scene Preview) */}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="font-black text-slate-800 dark:text-slate-100 text-lg">장면 미리보기</h3>
                      <button className="text-xs font-bold text-purple-600 bg-purple-50 dark:bg-purple-900/30 px-3 py-1.5 rounded-full">전체 보기</button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Item 1 */}
                      <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-slate-700 aspect-[9/16] relative group">
                        <img src="https://images.unsplash.com/photo-1620207418302-439b387441b0?q=80&w=400&auto=format&fit=crop" className="w-full h-full object-cover" alt="preview" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-4">
                          <span className="material-symbols-outlined text-white mb-2 drop-shadow-md">play_circle</span>
                          <p className="text-white text-xs font-medium line-clamp-2 drop-shadow-md">"세탁기, 아직도 겉만 닦으시나요?..."</p>
                        </div>
                      </div>

                      {/* Item 2 */}
                      <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-slate-700 aspect-[9/16] relative group">
                        <img src="https://images.unsplash.com/photo-1581622558667-3419a8dc5f83?q=80&w=400&auto=format&fit=crop" className="w-full h-full object-cover" alt="preview" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-4">
                          <span className="material-symbols-outlined text-white mb-2 drop-shadow-md">play_circle</span>
                          <p className="text-white text-xs font-medium line-clamp-2 drop-shadow-md">"여름 필수 홈케어 꿀팁 대방출..."</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 발행 준비 완료 (Ready to Publish) */}
                  <div className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-5 border border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-800 dark:text-white text-sm">발행 준비 완료</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">4K 해상도로 유튜브에 직접 내보내기</p>
                    </div>
                    <button className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 w-10 h-10 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform hover:bg-black/80">
                      <span className="material-symbols-outlined text-xl">file_upload</span>
                    </button>
                  </div>
                </>
              )}

              {/* 제작 화면 */}
              {shortsView === 'create' && (
                <div className="bg-white dark:bg-slate-800 p-6 flex flex-col gap-5 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700 animate-slide-up">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setShortsView('home')} className="flex items-center justify-center bg-slate-100 text-slate-500 rounded-full w-8 h-8 hover:bg-slate-200">
                      <span className="material-symbols-outlined text-sm">arrow_back</span>
                    </button>
                    <h3 className="font-black text-slate-800 dark:text-white text-lg">새로운 스크립트 작성</h3>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-300">📌 콘텐츠 주제</label>
                    <textarea
                      value={shortsTopic}
                      onChange={e => { setShortsTopic(e.target.value); setShortsError(""); }}
                      placeholder="예) 에어컨 분해 청소 안 하면 생기는 끔찍한 일벌레와 곰팡이들..."
                      rows={3}
                      className={`w-full bg-slate-50 dark:bg-slate-900 border ${shortsError ? 'border-red-400 focus:ring-red-400' : 'border-slate-200 dark:border-slate-700 focus:ring-purple-500'} rounded-xl p-4 text-sm outline-none transition-all resize-none`}
                    />
                    {shortsError && <p className="text-red-500 text-xs mt-1">{shortsError}</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 dark:text-slate-300">🎭 카테고리</label>
                      <select value={shortsCategory} onChange={e => setShortsCategory(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 text-sm outline-none">
                        {SHORTS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 dark:text-slate-300">⏱ 영상 길이</label>
                      <select value={shortsDuration} onChange={e => setShortsDuration(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 text-sm outline-none">
                        <option value="30">30초</option>
                        <option value="60">60초</option>
                        <option value="90">90초</option>
                      </select>
                    </div>
                  </div>

                  <button onClick={generateShortsScript} className="w-full bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white font-black py-4 rounded-xl shadow-lg shadow-purple-500/30 active:scale-95 transition-all text-[15px] flex items-center justify-center gap-2 mt-2">
                    <span className="material-symbols-outlined text-lg">auto_awesome</span>
                    스크립트 생성하기
                  </button>
                </div>
              )}

              {/* 로딩 화면 */}
              {shortsView === 'loading' && (
                <div className="bg-white dark:bg-slate-800 p-10 flex flex-col items-center justify-center gap-5 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700 h-64">
                  <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
                  <div className="text-center space-y-1">
                    <p className="text-purple-600 font-black animate-pulse">AI가 스크립트를 작성 중입니다...</p>
                    <p className="text-xs text-slate-400">보통 10~20초 안에 완료됩니다.</p>
                  </div>
                </div>
              )}

              {/* 결과 화면 */}
              {shortsView === 'result' && (
                <div className="bg-white dark:bg-slate-800 p-6 flex flex-col gap-4 rounded-2xl shadow-lg border border-purple-200 dark:border-purple-600/30 animate-slide-up">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setShortsView('create')} className="flex items-center gap-2 text-slate-500 text-xs font-bold px-3 py-1.5 bg-slate-100 rounded-lg hover:bg-slate-200">
                      <span className="material-symbols-outlined text-sm">refresh</span> 다시 만들기
                    </button>
                    <span className="text-purple-600 font-bold text-sm flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">task_alt</span> 완성 완료
                    </span>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 text-sm leading-relaxed whitespace-pre-wrap max-h-[360px] overflow-y-auto font-medium text-slate-700 dark:text-slate-300">
                    {shortsScript}
                  </div>

                  <button onClick={handleCopyShortsScript} className="w-full bg-purple-100 text-purple-700 border border-purple-200 font-black py-4 rounded-xl active:scale-95 transition-all text-sm flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-lg">content_copy</span>
                    스크립트 클립보드에 복사하기
                  </button>
                </div>
              )}

            </div>
          )}

        </main>
      )}

      {/* ======================= [탭 5/6: 지출 및 세무 관리] ======================= */}
      {currentTab === 'tax_expense' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-6 animate-slide-up pb-32">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">account_balance_wallet</span> 지출 및 세무
            </h2>
          </div>

          {/* 서브 탭 카테고리 버튼 */}
          <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
            <button
              onClick={() => setTaxExpenseSubTab('expense')}
              className={`flex-1 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${taxExpenseSubTab === 'expense' ? 'bg-white dark:bg-slate-700 text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <span className="material-symbols-outlined text-sm">receipt_long</span> 지출 관리
            </button>
            <button
              onClick={() => setTaxExpenseSubTab('tax')}
              className={`flex-1 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${taxExpenseSubTab === 'tax' ? 'bg-white dark:bg-slate-700 text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <span className="material-symbols-outlined text-sm">analytics</span> 세무 현황
            </button>
            <button
              onClick={() => setTaxExpenseSubTab('quotation')}
              className={`flex-1 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 ${taxExpenseSubTab === 'quotation' ? 'bg-white dark:bg-slate-700 text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <span className="material-symbols-outlined text-sm">request_quote</span> 견적서
            </button>
          </div>

          {/* --- 서브 탭 1: 지출 관리 --- */}
          {taxExpenseSubTab === 'expense' && (
            <div className="space-y-6 animate-fade-in">
              <form onSubmit={handleSaveExpense} className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-5 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">지출 금액 (원)</label>
                  <input type="text" required value={exAmount} onChange={e => setExAmount(fmtNum(e.target.value.replace(/[^0-9]/g, '')))} className="w-full bg-slate-50 border border-slate-200 dark:bg-slate-900/50 dark:border-slate-700 rounded-xl p-3 text-sm font-bold text-right focus:ring-2" placeholder="0" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">카테고리</label>
                    <select value={exCategory} onChange={e => setExCategory(e.target.value)} className="w-full bg-slate-50 border border-slate-200 dark:bg-slate-900/50 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2">
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
                  <input type="text" value={exMemo} onChange={e => setExMemo(e.target.value)} className="w-full p-3 rounded-xl border bg-slate-50 dark:bg-slate-900/50 dark:border-slate-700 outline-none focus:ring-2" placeholder="예: 철물점 마스킹 테이프" />
                </div>

                <div className="flex gap-4 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={exHasTaxInvoice} onChange={e => { setExHasTaxInvoice(e.target.checked); if(e.target.checked) setExHasCashReceipt(false); }} className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">세금계산서 발행</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={exHasCashReceipt} onChange={e => { setExHasCashReceipt(e.target.checked); if(e.target.checked) setExHasTaxInvoice(false); }} className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">지출증빙(현금영수증) 발행</span>
                  </label>
                </div>

                <div className="flex gap-2">
                  <button disabled={isSavingExpense} type="submit" className="flex-1 py-3.5 bg-primary text-white font-bold rounded-xl active:scale-95 transition-transform flex justify-center gap-2 items-center">
                    <span className="material-symbols-outlined">{isSavingExpense ? 'sync' : editingExpenseId ? 'save' : 'add_circle'}</span>
                    {isSavingExpense ? '저장 중...' : editingExpenseId ? '지출 내역 수정 완료' : '지출 내역 등록'}
                  </button>
                  {editingExpenseId && (
                    <button
                      type="button"
                      onClick={() => { setEditingExpenseId(null); setExAmount(''); setExMemo(''); setExReceiptFile(null); setExHasCashReceipt(false); setExHasTaxInvoice(false); }}
                      className="px-4 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl active:scale-95 transition-all"
                    >
                      취소
                    </button>
                  )}
                </div>
              </form>

              <div>
                <h3 className="font-bold text-sm text-slate-600 dark:text-slate-400 mb-2 px-1">최근 지출 내역 ({expenses.length}건)</h3>
                <div className="space-y-2">
                  {expenses.map(e => (
                    <div key={e.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-[0_2px_15px_-5px_rgba(0,0,0,0.05)] text-sm border-0 flex justify-between items-center group">
                      <div className="flex-1">
                        <span className="font-bold flex items-center gap-1 text-slate-800 dark:text-slate-200">
                          {e.memo || e.category}
                          {e.receipt_url && <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded ml-1 font-bold">영수증 보기</a>}
                        </span>
                        <span className="text-xs text-slate-400 block mt-1 flex flex-wrap gap-1 items-center">
                          {e.date_created} · {e.category}
                          {e.has_tax_invoice && <span className="bg-blue-100 text-blue-600 text-[10px] font-black px-1.5 py-0.5 rounded ml-1">세금계산서</span>}
                          {e.has_cash_receipt && <span className="bg-purple-100 text-purple-600 text-[10px] font-black px-1.5 py-0.5 rounded ml-1">지출증빙</span>}
                        </span>
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
                  {expenses.length === 0 && <p className="text-center text-xs text-slate-400 py-4 italic">등록된 지출 내역이 없습니다.</p>}
                </div>
              </div>
            </div>
          )}

          {/* --- 서브 탭 2: 세무 대시보드 --- */}
          {taxExpenseSubTab === 'tax' && (() => {
            const taxInfo = calcTax();
            const aiAdvice = getAiTaxAdvice();
            const currentYear = new Date().getFullYear();
            const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
            const isTaxMonth = [1, 5, 7, 11].includes(taxMonth);
            const taxAlertText = taxMonth === 1 || taxMonth === 7 ? "부가가치세 확정 신고 달입니다!" : taxMonth === 5 ? "종합소득세 신고 달입니다!" : taxMonth === 11 ? "종합소득세 중간예납 달입니다!" : "";
            const isCurrentlyGeneral = businessProfile?.taxpayer_type === '일반과세자';

            return (
              <div className="space-y-5 animate-fade-in">
                <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-2 rounded-xl border-2 border-slate-100 dark:border-slate-700 shadow-sm">
                  <select value={taxYear} onChange={e => setTaxYear(Number(e.target.value))} className="bg-transparent dark:text-white font-bold text-center px-2 py-2 outline-none w-1/2 border-r dark:border-slate-700">
                    {years.map(y => <option key={y} value={y}>{y}년</option>)}
                  </select>
                  <select value={taxMonth} onChange={e => setTaxMonth(Number(e.target.value))} className="bg-transparent dark:text-white font-bold text-center px-2 py-2 outline-none w-1/2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => <option key={m} value={m}>{m}월</option>)}
                  </select>
                </div>

                {isTaxMonth && (
                  <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl border border-red-200 dark:border-red-800/50 flex font-bold items-center gap-2 animate-pulse">
                    <span className="material-symbols-outlined">notification_important</span>
                    {taxAlertText}
                  </div>
                )}

                <div className="bg-white dark:bg-slate-800 rounded-[2.2rem] p-6 shadow-sm border border-slate-50 dark:border-slate-700/50">
                  <p className="text-xs font-bold text-slate-400 text-center mb-1">선택 기간 예상 부가가치세</p>
                  <p className="text-[10px] text-primary bg-primary/10 w-fit mx-auto px-2 py-0.5 rounded-full font-bold mb-5">
                    현재 [{businessProfile.taxpayer_type || '간이과세자'}] 과세자 기준
                  </p>

                  <div className="space-y-4 mb-6">
                    <div className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 dark:border-slate-700">
                      <span className="text-sm font-bold text-slate-600 dark:text-slate-300">➕ 매출 세액</span>
                      <div className="text-right">
                        <span className="font-black text-red-500">{fmtNum(taxInfo.salesTax)}원</span>
                        <p className="text-[9px] text-slate-400">과세매출: {fmtNum(taxInfo.taxableSales)}원</p>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 dark:border-slate-700">
                      <span className="text-sm font-bold text-slate-600 dark:text-slate-300">➖ 매입(지출) 공제 세액</span>
                      <div className="text-right">
                        <span className="font-black text-green-600">-{fmtNum(taxInfo.purchaseTax)}원</span>
                        <p className="text-[9px] text-slate-400">총 지출: {fmtNum(taxInfo.thisMonthExpenses)}원</p>
                      </div>
                    </div>

                    {taxInfo.creditCardDeduction > 0 && (
                      <div className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 dark:border-slate-700">
                        <span className="text-sm font-bold text-slate-600 dark:text-slate-300">➖ 신용카드 발행공제</span>
                        <span className="font-black text-green-600">-{fmtNum(taxInfo.creditCardDeduction)}원</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-4 text-center border dark:border-slate-700 overflow-hidden relative">
                    <p className="text-xs font-bold text-slate-500 mb-1">최종 예상 납부 세액</p>
                    <p className="text-3xl font-black text-primary">{fmtNum(taxInfo.finalTax)}원</p>
                  </div>
                </div>

                <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 p-5 rounded-[1.5rem] shadow-sm">
                  <h4 className="font-black text-indigo-800 dark:text-indigo-400 text-base mb-3 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[20px]">recommend</span> 부가세 환급 대상 분석
                  </h4>
                  <div className="space-y-2">
                    {expenses
                      .filter(e => e.date_created?.startsWith(`${taxYear}-${String(taxMonth).padStart(2, '0')}`))
                      .filter(e => ['자재/장비', '유류비', '차량유지비', '광고비'].includes(e.category))
                      .map(e => (
                        <div key={e.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-indigo-100 dark:border-indigo-800/30 flex justify-between items-center text-sm">
                          <div className="flex-1 overflow-hidden">
                            <span className="font-bold flex items-center gap-1 truncate text-slate-700 dark:text-slate-300">{e.memo || e.category}</span>
                            <span className="text-[10px] text-slate-400 block mt-0.5">{e.date_created} · {e.category}</span>
                          </div>
                          <div className="text-right ml-2 flex-shrink-0">
                            <div className="font-black text-slate-600 dark:text-slate-400">{fmtNum(e.amount)}원</div>
                            {e.receipt_url ? (
                              <span className="text-[9px] text-indigo-600 font-bold bg-indigo-50 dark:bg-indigo-900/50 px-1 py-0.5 rounded">환급: {fmtNum(Math.floor(e.amount * 0.1))}원</span>
                            ) : (
                              <span className="text-[9px] text-red-500 font-bold bg-red-50 dark:bg-red-900/50 px-1 py-0.5 rounded">🚨 증빙 보완</span>
                            )}
                          </div>
                        </div>
                      ))}
                    {expenses.filter(e => e.date_created?.startsWith(`${taxYear}-${String(taxMonth).padStart(2, '0')}`) && ['자재/장비', '유류비', '차량유지비', '광고비'].includes(e.category)).length === 0 && (
                      <p className="text-center text-xs text-slate-400 py-3 italic bg-white/50 rounded-xl">환급 가능 지출이 없습니다.</p>
                    )}
                  </div>
                </div>

                <div className="bg-slate-800 text-white p-6 rounded-[1.5rem] space-y-4 shadow-lg">
                  <h4 className="font-black flex items-center gap-2"><span className="material-symbols-outlined text-blue-400">smart_toy</span> AI 세무 전략 어드바이저</h4>
                  <div className="space-y-3">
                    {aiAdvice.yrSales >= 70000000 && aiAdvice.yrSales < 104000000 && !isCurrentlyGeneral && (
                      <div className="bg-white/10 p-3 rounded-xl text-xs leading-relaxed font-medium">
                        <span className="text-red-400 font-bold mr-1">⚠️ 주의:</span> 올해 누적 매출이 8천만 원에 근접했습니다. 내년에 <span className="font-black underline">일반과세자 전환</span> 가능성이 높으니 매입 세금계산서를 철저히 준비하세요!
                      </div>
                    )}
                    <div className="bg-white/10 p-3 rounded-xl text-xs leading-relaxed font-medium">
                      <span className="text-blue-400 font-bold mr-1">📊 일반과세 시뮬레이션:</span>
                      이 기간부터 일반과세자였다면 예상 세액은 <span className="font-black text-blue-300">{fmtNum(aiAdvice.simulatedGenTax)}원</span> 입니다.
                    </div>
                  </div>
                </div>

                <button onClick={exportToCSV} className="w-full py-4 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-2xl active:scale-95 transition-all flex justify-center items-center gap-2 border dark:border-slate-600">
                  <span className="material-symbols-outlined">mail</span> {taxYear}년치 자료 엑셀(CSV) 저장
                </button>
              </div>
            );
          })()}

          {/* --- 서브 탭 3: 견적서 작성 --- */}
          {taxExpenseSubTab === 'quotation' && (() => {
            const quoteSubtotal = quoteItems.reduce((acc, item) => acc + (Number(item.unitPrice) * Number(item.qty)), 0);
            const quoteVat = quoteVatType === 'excluded' ? Math.floor(quoteSubtotal * 0.1) : 0;
            const quoteTotal = quoteSubtotal + quoteVat;

            return (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-5 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] space-y-4">
                  <h3 className="font-black text-primary">견적 정보 입력</h3>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-slate-500 mb-1">받는 분 (요청 업체/고객명)</label>
                      <input type="text" value={quoteTarget} onChange={e => setQuoteTarget(e.target.value)} className="w-full bg-slate-50 border border-slate-200 dark:bg-slate-900/50 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2" placeholder="예: 홍길동 고객님" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-slate-500 mb-1">견적 프로젝트명</label>
                      <input type="text" value={quoteProject} onChange={e => setQuoteProject(e.target.value)} className="w-full bg-slate-50 border border-slate-200 dark:bg-slate-900/50 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2" placeholder="예: 사업장 에어컨 대량청소 건" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-slate-500 mb-2">부가세 여부</label>
                      <div className="flex bg-slate-100 dark:bg-slate-900 rounded-xl p-1">
                        <button onClick={() => setQuoteVatType('included')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${quoteVatType === 'included' ? 'bg-white shadow text-primary' : 'text-slate-500'}`}>VAT 포함</button>
                        <button onClick={() => setQuoteVatType('excluded')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${quoteVatType === 'excluded' ? 'bg-white shadow text-primary' : 'text-slate-500'}`}>VAT 별도 (+10%)</button>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 dark:border-slate-700 pt-4 mt-4">
                    <div className="flex justify-between items-center mb-3">
                      <label className="text-xs font-bold text-slate-500">견적 품목</label>
                      <button onClick={() => setQuoteItems([...quoteItems, { id: Date.now(), name: '', qty: 1, unitPrice: 0 }])} className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-bold hover:bg-primary/20 active:scale-95 transition-all flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">add</span> 품목 추가
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {quoteItems.map((item, idx) => (
                        <div key={item.id} className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700 flex gap-2 items-center relative">
                          <button onClick={() => setQuoteItems(quoteItems.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center font-bold text-xs hover:bg-red-200">✕</button>
                          
                          <div className="flex-1 grid grid-cols-4 gap-2">
                            <div className="col-span-4">
                              <input type="text" value={item.name} onChange={e => { const newItems = [...quoteItems]; newItems[idx].name = e.target.value; setQuoteItems(newItems); }} placeholder="품목 (예: 벽걸이 에어컨)" className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg p-2 text-xs focus:ring-1" list="quote-presets" />
                            </div>
                            <div className="col-span-1">
                              <input type="number" min="1" value={item.qty} onChange={e => { const newItems = [...quoteItems]; newItems[idx].qty = Number(e.target.value); setQuoteItems(newItems); }} className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg p-2 text-xs text-center focus:ring-1" placeholder="수량" />
                            </div>
                            <div className="col-span-3">
                              <input type="text" value={item.unitPrice} onChange={e => { const newItems = [...quoteItems]; newItems[idx].unitPrice = e.target.value.replace(/[^0-9]/g, ''); setQuoteItems(newItems); }} className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg p-2 text-xs text-right focus:ring-1" placeholder="단가 (원)" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <datalist id="quote-presets">
                      <option value="벽걸이 에어컨 완전분해청소" />
                      <option value="스탠드 에어컨 완전분해청소" />
                      <option value="2in1 에어컨 완전분해청소" />
                      <option value="시스템(천장형) 에어컨 완전분해청소" />
                      <option value="출장 점검비" />
                    </datalist>
                  </div>

                  <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-xl mt-4">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>공급가액</span>
                      <span>{fmtNum(quoteSubtotal)}원</span>
                    </div>
                    {quoteVatType === 'excluded' && (
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>부가세 (10%)</span>
                        <span>{fmtNum(quoteVat)}원</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-black mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span>총 견적금액</span>
                      <span className="text-primary">{fmtNum(quoteTotal)}원</span>
                    </div>
                  </div>

                  <button onClick={async () => {
                    const el = document.getElementById('quotation-card');
                    if (!el) return;
                    try {
                      const blob = await toBlob(el, {
                        backgroundColor: '#ffffff',
                        pixelRatio: 2,
                        style: {
                          transform: 'scale(1)',
                          transformOrigin: 'top left'
                        }
                      });
                      
                      if (!blob) {
                        alert('이미지 생성에 실패했습니다.');
                        return;
                      }
                      
                      const fileName = `견적서_${quoteTarget || '클린브로'}.png`;
                      
                      // 모바일(iOS/Android) 공유 API 지원 시 먼저 시도
                      if (navigator.canShare && navigator.userAgent.match(/mobile/i)) {
                        const file = new File([blob], fileName, { type: 'image/png' });
                        if (navigator.canShare({ files: [file] })) {
                          try {
                            await navigator.share({
                              files: [file],
                              title: fileName,
                            });
                            return;
                          } catch (err) {
                            console.log('Share canceled or failed:', err);
                          }
                        }
                      }

                      // Fallback: 일반 다운로드 (PC 또는 공유 미지원 기기)
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.download = fileName;
                      link.href = url;
                      document.body.appendChild(link); // iOS Safari 대응을 위해 추가
                      link.click();
                      document.body.removeChild(link);
                      setTimeout(() => URL.revokeObjectURL(url), 100);
                    } catch (e) {
                      alert('이미지 처리 중 오류가 발생했습니다: ' + e.message);
                    }
                  }} className="w-full py-4 bg-primary text-white font-bold rounded-2xl active:scale-95 transition-all shadow-lg flex items-center justify-center gap-2 mt-4">
                    <span className="material-symbols-outlined">ios_share</span> 견적서 카톡 전송 / 저장하기
                  </button>
                </div>

                {/* 견적서 실제 렌더링 카드 (이 영역이 캡쳐됩니다) */}
                {/* 캡쳐 시 oklch 파싱 에러를 방지하기 위해 Tailwind 색상 클래스 대신 인라인 hex 스타일을 사용합니다. */}
                <div className="overflow-x-auto pb-4">
                  <div id="quotation-card" className="p-6 rounded-none" style={{ width: '400px', margin: '0 auto', fontFamily: 'sans-serif', backgroundColor: '#ffffff', color: '#1e293b' }}>
                    <div className="text-center mb-6 border-b-2 pb-4" style={{ borderColor: '#1e293b' }}>
                      <h1 className="text-3xl font-black tracking-widest" style={{ color: '#1e293b' }}>견 적 서</h1>
                    </div>
                    
                    <div className="flex justify-between items-end mb-6">
                      <div>
                        <div className="text-lg font-bold border-b inline-block pr-4 pb-1 mb-1" style={{ borderColor: '#94a3b8', color: '#1e293b' }}>
                          {quoteTarget || '(받는 분 이름)'} <span className="text-sm font-normal">귀하</span>
                        </div>
                        <div className="text-xs mt-2" style={{ color: '#64748b' }}>견적일: {quoteDate}</div>
                        <div className="text-xs" style={{ color: '#64748b' }}>프로젝트: {quoteProject}</div>
                      </div>
                      
                      <div className="text-right text-[11px] leading-relaxed" style={{ color: '#334155' }}>
                        <div className="font-black text-sm mb-1" style={{ color: '#2563eb' }}>클린브로</div>
                        <div>사업자번호: 803-53-00875</div>
                        <div>대표자: 최찬용</div>
                        <div>속초시 동해대로 3930번길 10-8</div>
                        <div>전화: 010-2716-8635</div>
                      </div>
                    </div>

                    <div className="p-4 mb-4 rounded-lg flex justify-between items-center border" style={{ backgroundColor: '#f1f5f9', borderColor: '#e2e8f0' }}>
                      <div className="font-bold" style={{ color: '#1e293b' }}>견적 총액<br/><span className="text-[10px] font-normal" style={{ color: '#64748b' }}>({quoteVatType === 'included' ? 'VAT 포함' : 'VAT 별도'})</span></div>
                      <span className="text-xl font-black" style={{ color: '#2563eb' }}>₩ {fmtNum(quoteTotal)}</span>
                    </div>

                    <table className="w-full text-xs text-left mb-6 border-collapse">
                      <thead>
                        <tr className="border-b border-t" style={{ borderColor: '#1e293b', backgroundColor: '#f8fafc', color: '#1e293b' }}>
                          <th className="py-2 px-2 font-bold">품목 / 내역</th>
                          <th className="py-2 px-2 font-bold text-center w-12">수량</th>
                          <th className="py-2 px-2 font-bold text-right">단가</th>
                          <th className="py-2 px-2 font-bold text-right">금액</th>
                        </tr>
                      </thead>
                      <tbody style={{ color: '#1e293b' }}>
                        {quoteItems.map((item, idx) => (
                          <tr key={item.id || idx} className="border-b" style={{ borderColor: '#e2e8f0' }}>
                            <td className="py-3 px-2 font-medium">{item.name || '(품목명)'}</td>
                            <td className="py-3 px-2 text-center">{item.qty || 1}</td>
                            <td className="py-3 px-2 text-right">{fmtNum(item.unitPrice || 0)}</td>
                            <td className="py-3 px-2 text-right font-bold">{fmtNum((item.unitPrice || 0) * (item.qty || 1))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="flex justify-end mb-6 text-xs border-b pb-2" style={{ borderColor: '#e2e8f0' }}>
                      <div className="w-1/2 space-y-1">
                        <div className="flex justify-between">
                          <span style={{ color: '#64748b' }}>공급가액:</span>
                          <span className="font-bold">{fmtNum(quoteSubtotal)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span style={{ color: '#64748b' }}>부가세액:</span>
                          <span className="font-bold">{fmtNum(quoteVat)}</span>
                        </div>
                        <div className="flex justify-between text-sm font-black pt-1 border-t" style={{ borderColor: '#cbd5e1' }}>
                          <span>합계:</span>
                          <span style={{ color: '#2563eb' }}>{fmtNum(quoteTotal)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="border p-4 text-[10px] space-y-1" style={{ borderColor: '#e2e8f0', backgroundColor: '#f8fafc', color: '#475569' }}>
                      <p className="font-bold mb-1" style={{ color: '#1e293b' }}>안내 및 입금계좌</p>
                      <p>- 본 견적은 작성일로부터 14일간 유효합니다.</p>
                      <p>- <strong style={{ color: '#1e293b' }}>카카오뱅크 3333-36-2878313 (예금주: 최찬용)</strong></p>
                    </div>
                    
                    <div className="mt-8 text-center text-xs font-bold" style={{ color: '#64748b' }}>
                      위와 같이 견적합니다.
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </main>
      )}

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

          <button onClick={() => { resetBookingForm(); setCurrentTab('add'); }} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'add' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'add' ? 'font-fill' : ''}`}>edit_calendar</span>
            <p className={`text-[9px] ${currentTab === 'add' ? 'font-bold' : 'font-medium'}`}>예약</p>
          </button>

          <button onClick={() => setCurrentTab('stats')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'stats' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'stats' ? 'font-fill' : ''}`}>monitoring</span>
            <p className={`text-[9px] ${currentTab === 'stats' ? 'font-bold' : 'font-medium'}`}>통계</p>
          </button>

          <button onClick={() => setCurrentTab('tax_expense')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'tax_expense' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'tax_expense' ? 'font-fill' : ''}`}>account_balance_wallet</span>
            <p className={`text-[9px] ${currentTab === 'tax_expense' ? 'font-bold' : 'font-medium'}`}>지출/세무</p>
          </button>

          <button onClick={() => setCurrentTab('proshop')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'proshop' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'proshop' ? 'font-fill' : ''}`}>local_mall</span>
            <p className={`text-[9px] ${currentTab === 'proshop' ? 'font-bold' : 'font-medium'}`}>프로샵</p>
          </button>

          <button onClick={() => setCurrentTab('karrot')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'karrot' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'karrot' ? 'font-fill' : ''}`}>cruelty_free</span>
            <p className={`text-[9px] ${currentTab === 'karrot' ? 'font-bold' : 'font-medium'}`}>당근소식</p>
          </button>

          <button onClick={() => setCurrentTab('settings')} className={`flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${currentTab === 'settings' ? 'text-primary' : 'text-slate-400 hover:text-primary/70'}`}>
            <span className={`material-symbols-outlined text-[24px] ${currentTab === 'settings' ? 'font-fill' : ''}`}>manage_accounts</span>
            <p className={`text-[9px] ${currentTab === 'settings' ? 'font-bold' : 'font-medium'}`}>설정</p>
          </button>
        </div>
      </nav>

      {/* ======================= [탭: 당근 소식 (Karrot News)] ======================= */}
      {currentTab === 'karrot' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-5 animate-slide-up pb-32">
          <div className="flex justify-between items-end mb-2 mt-4">
            <div>
              <h2 className="text-2xl font-black flex items-center gap-2 text-orange-600">
                <span className="material-symbols-outlined text-orange-500">cruelty_free</span> 당근 소식
              </h2>
              <p className="text-xs text-slate-500 mt-1">블로그 작성 시 자동 생성된 동네요정 말투의 소식글입니다.</p>
            </div>
            <button
               onClick={fetchSocialPosts}
               disabled={isFetchingSocialPosts}
               className="p-2 bg-slate-100 rounded-xl text-slate-500 active:scale-95"
            >
               <span className={`material-symbols-outlined text-sm ${isFetchingSocialPosts ? 'animate-spin' : ''}`}>sync</span>
            </button>
          </div>

          <div className="space-y-4">
            {socialPosts.length === 0 && !isFetchingSocialPosts && (
              <div className="py-10 text-center text-slate-400">
                <span className="material-symbols-outlined text-[48px] opacity-20 mb-2">inbox</span>
                <p className="text-sm">아직 생성된 당근 소식이 없습니다.</p>
              </div>
            )}
            
            {socialPosts.map(post => (
              <div key={post.id} className="bg-white rounded-[20px] shadow-sm border border-orange-100/50 overflow-hidden flex flex-col">
                {/* 썸네일 & 헤더 */}
                <div className="flex bg-slate-50 p-3 gap-3">
                  {post.image_url ? (
                    <img src={post.image_url} alt="썸네일" className="w-16 h-16 rounded-xl object-cover bg-slate-200" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-orange-50 flex items-center justify-center text-orange-300">
                      <span className="material-symbols-outlined">image</span>
                    </div>
                  )}
                  <div className="flex-1 flex flex-col justify-center">
                    <p className="text-xs text-orange-500 font-bold">{new Date(post.created_at).toLocaleDateString()}</p>
                    <h3 className="text-sm font-black text-slate-700 line-clamp-2 leading-tight mt-0.5">{post.blog_title || '연관 블로그 제목 없음'}</h3>
                  </div>
                </div>
                
                {/* 당근용 텍스트 컨텐츠 */}
                <div className="p-4 bg-white">
                  <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                    {post.karrot_content}
                  </p>
                </div>
                
                {/* 액션 버튼 */}
                <div className="p-3 border-t border-slate-50 bg-slate-50/50 flex gap-2">
                  <button
                    onClick={() => {
                       navigator.clipboard.writeText(post.karrot_content);
                       alert('당근마켓용 본문이 복사되었습니다! 당근 앱에 붙여넣기 하세요.');
                    }}
                    className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 text-xs font-bold active:scale-95 flex items-center justify-center gap-1 shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]">content_copy</span> 내용 복사
                  </button>
                  <button
                    onClick={() => markSocialPostAsDone(post.id, post.is_posted_karrot)}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 flex items-center justify-center gap-1 shadow-sm transition-colors ${
                      post.is_posted_karrot 
                        ? 'bg-slate-200 text-slate-500' 
                        : 'bg-orange-500 text-white shadow-orange-500/20'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {post.is_posted_karrot ? 'check_circle' : 'publish'}
                    </span> 
                    {post.is_posted_karrot ? '발행 완료' : '발행하기'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* ======================= [탭 7: 프로 샵] ======================= */}
      {currentTab === 'proshop' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-5 animate-slide-up pb-32">
          <div className="flex justify-between items-end mb-2">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">local_mall</span> 프로 샵
            </h2>
            {isAdmin && (
              <button onClick={() => { setEditingProduct({ title: '', description: '', image_url: '', link_url: '', category: '에어컨용', platform: '쿠팡', tag: '', price: '', stock: '' }); setProductImageFile(null); setShowProductModal(true); }} className="text-xs font-bold bg-slate-800 text-white px-3 py-1.5 rounded-xl active:scale-95 shadow-sm">
                + 상품 추가
              </button>
            )}
          </div>

          <div className="flex gap-2 pb-2 overflow-x-auto scrollbar-hide">
            {['전체', '에어컨용', '세탁기용', '공용'].map(cat => (
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
            {products
              .filter(p => {
                if (productCategory === '전체') return true;
                if (p.category === '공용') return true; // 공용 상품은 어느 탭에서나 보임
                return p.category === productCategory;
              })
              .map(p => (
                <div key={p.id} className="bg-white dark:bg-slate-800 rounded-2xl p-3 shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col cursor-pointer active:scale-95 transition-transform" onClick={() => p.link_url && window.open(p.link_url, '_blank')}>
                  <div className="relative aspect-square rounded-xl bg-slate-50 overflow-hidden mb-3">
                    <img src={p.image_url || 'https://via.placeholder.com/300?text=No+Image'} alt={p.title} className="w-full h-full object-cover" />
                    <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                      {p.platform === '쿠팡' && (
                        <div className="bg-[#0055ff] text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm flex items-center gap-0.5">
                          <span className="text-[10px]">C</span>OUPANG
                        </div>
                      )}
                      {p.platform === '알리' && (
                        <div className="bg-[#ff4747] text-white text-[8px] font-black px-1.5 py-0.5 rounded shadow-sm flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[10px]">shopping_bag</span> Ali
                        </div>
                      )}
                      {p.stock <= 5 && p.stock > 0 && <span className="bg-orange-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm">품절임박</span>}
                      {p.stock <= 0 && <span className="bg-slate-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm">품절</span>}
                    </div>
                  </div>
                  {p.tag && <span className="self-start text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mb-1">{p.tag}</span>}
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${p.category === '에어컨용' ? 'bg-blue-100 text-blue-600' : p.category === '세탁기용' ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-600'}`}>
                      {p.category}
                    </span>
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100 line-clamp-1 leading-tight">{p.title}</h4>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 flex-1 mb-1">{p.description}</p>
                  <p className="font-black text-primary text-sm mb-1">{fmtNum(p.price)}원</p>
                  <div className="flex justify-between items-center text-[9px] text-slate-400 font-bold mb-1">
                    <span>재고: {p.stock}개</span>
                  </div>
                  {p.platform === '알리' && (
                    <p className="text-[9px] text-orange-500 font-bold mt-1.5 leading-tight flex items-start gap-0.5 bg-orange-50 p-1.5 rounded-lg border border-orange-100 shrink-0">
                      <span className="material-symbols-outlined text-[10px]">flight_takeoff</span>
                      해외 직구 상품
                    </p>
                  )}
                  {isAdmin && (
                    <div className="mt-2 flex gap-1 justify-end border-t border-slate-50 pt-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingProduct(p); setShowProductModal(true); }} className="text-[10px] text-blue-500 font-bold px-2 py-1 bg-blue-50 rounded">수정</button>
                      <button onClick={() => handleDeleteProduct(p.id)} className="text-[10px] text-red-500 font-bold px-2 py-1 bg-red-50 rounded">삭제</button>
                    </div>
                  )}
                </div>
              ))}
            {products.filter(p => productCategory === '전체' || p.category === productCategory).length === 0 && (
              <div className="col-span-2 text-center text-xs text-slate-400 py-10 bg-white/50 rounded-2xl">등록된 상품이 없습니다.</div>
            )}
          </div>

          <div className="mt-8 pt-4 border-t border-slate-200/50">
            <p className="text-[10px] text-slate-400 text-center font-medium">관리자가 직접 선정한 추천 제품 리스트입니다.</p>
          </div>
        </main>
      )}

      {/* 상품 추가/수정 모달 */}
      {showProductModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-fade-in font-display">
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl overflow-hidden animate-slide-up">
            <h3 className="text-lg font-black mb-4 flex items-center gap-1.5"><span className="material-symbols-outlined text-primary">edit_square</span> 상품 등록 / 수정</h3>
            <form onSubmit={handleSaveProduct} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">카테고리</label>
                  <select value={editingProduct.category} onChange={e => setEditingProduct({ ...editingProduct, category: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm">
                    <option value="에어컨용">에어컨용</option>
                    <option value="세탁기용">세탁기용</option>
                    <option value="공용">공용</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">상품명</label>
                  <input type="text" required value={editingProduct.title} onChange={e => setEditingProduct({ ...editingProduct, title: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm" placeholder="제품명 입력" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">가격 (원)</label>
                  <input type="text" required value={fmtNum(editingProduct.price)} onChange={e => setEditingProduct({ ...editingProduct, price: e.target.value.replace(/[^0-9]/g, '') })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">재고 수량</label>
                  <input type="number" required value={editingProduct.stock} onChange={e => setEditingProduct({ ...editingProduct, stock: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm" placeholder="0" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">상세 설명</label>
                <textarea value={editingProduct.description} onChange={e => setEditingProduct({ ...editingProduct, description: e.target.value })} className="w-full p-2.5 rounded-xl border bg-slate-50 text-sm h-20" placeholder="상품에 대한 상세 설명을 적어주세요."></textarea>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">상품 사진 (갤러리/카메라)</label>
                <input type="file" accept="image/*" onChange={e => setProductImageFile(e.target.files[0])} className="w-full text-[10px] p-2 border rounded-xl" />
                {editingProduct.image_url && !productImageFile && (
                  <p className="text-[9px] text-slate-400 mt-1">현재 이미지: {editingProduct.image_url.substring(0, 30)}...</p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 mb-2">추가 정보 (선택사항)</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">플랫폼 연동</label>
                    <select value={editingProduct.platform || ''} onChange={e => setEditingProduct({ ...editingProduct, platform: e.target.value })} className="w-full p-2 rounded-lg border bg-slate-50 text-[10px]">
                      <option value="">없음</option>
                      <option value="쿠팡">쿠팡</option>
                      <option value="알리">알리</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">강조 태그</label>
                    <select value={editingProduct.tag || ''} onChange={e => setEditingProduct({ ...editingProduct, tag: e.target.value })} className="w-full p-2 rounded-lg border bg-slate-50 text-[10px]">
                      <option value="">없음</option>
                      <option value="🚀 빠른배송">🚀 빠른배송</option>
                      <option value="👍 대표추천">👍 대표추천</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">외부 링크 (구매처)</label>
                  <input type="url" value={editingProduct.link_url} onChange={e => setEditingProduct({ ...editingProduct, link_url: e.target.value })} className="w-full p-2 rounded-lg border bg-slate-50 text-[10px]" placeholder="https://..." />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowProductModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl active:scale-95 text-sm">취소</button>
                <button disabled={isSavingProduct} type="submit" className="flex-1 py-3 bg-primary text-white font-bold rounded-xl active:scale-95 text-sm flex justify-center items-center gap-2">
                  {isSavingProduct && <span className="material-symbols-outlined animate-spin text-sm">sync</span>}
                  {isSavingProduct ? '저장 중...' : '상품 저장하기'}
                </button>
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

            <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center gap-4">
              <span className="text-5xl">✅</span>
              <h3 className="font-black text-xl text-slate-800 dark:text-white">작업 완료 처리할까요?</h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed">
                완료를 누르면 <strong>메시지앱</strong>이 열리고<br />
                완료 안내문구가 자동으로 입력됩니다.<br />
                <span className="text-blue-500 font-bold">사진 첨부는 블로그 작성 화면</span>에서 이어서 할 수 있어요.
              </p>
            </div>

            <div className="p-6 shrink-0 border-t bg-white dark:bg-slate-900 pb-10 flex gap-3">
              <button
                disabled={isUploadingPhotos}
                onClick={() => handleFinalComplete(false)}
                className="flex-1 py-4 bg-slate-100 text-slate-500 font-bold rounded-[1.5rem] active:scale-95 transition-all text-sm flex items-center justify-center gap-1 leading-tight"
              >
                문자 없이<br/>조용히 완료
              </button>

              <button
                disabled={isUploadingPhotos}
                onClick={() => handleFinalComplete(true)}
                className="flex-[2] py-4 bg-primary text-white font-black rounded-[1.5rem] shadow-xl shadow-primary/30 flex items-center justify-center gap-2 active:scale-95 transition-all text-[15px]"
              >
                {isUploadingPhotos ? (
                  <><span className="material-symbols-outlined animate-spin">sync</span> 처리 중...</>
                ) : (
                  <><span className="material-symbols-outlined text-[18px]">send</span> 완료 & 안내문자앱 열기</>
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
              {isAndroid ? (
                <button
                  onClick={() => {
                    const currentUrl = window.location.href.replace(/https?:\/\//, '');
                    const intentUrl = `intent://${currentUrl}#Intent;scheme=https;package=com.android.chrome;end`;
                    window.location.href = intentUrl;
                  }}
                  className="w-full bg-[#4285F4] text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 mb-2"
                >
                  <span className="material-symbols-outlined text-lg">rocket_launch</span>
                  크롬(Chrome)으로 즉시 전환
                </button>
              ) : (
                <p className="text-xs font-bold text-center text-slate-400">👇 아래 버튼을 눌러 링크를 복사하세요 👇</p>
              )}
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
                {isAndroid ? '앱 주소 복사 (크롬 자동전환 안될때)' : '앱 주소 복사하기'}
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
      {/* ======================= [탭 9: 공지사항 및 가이드] ======================= */}
      {currentTab === 'notice' && (
        <main className="flex-1 max-w-lg mx-auto w-full p-4 space-y-6 animate-slide-up pb-32">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-black flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">campaign</span> 공지사항 & 가이드
            </h2>
            <button onClick={() => setCurrentTab('calendar')} className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors">닫기</button>
          </div>

          {/* 주요 공지사항 카드 */}
          <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-6 rounded-[2rem] text-white shadow-xl relative overflow-hidden">
            <span className="material-symbols-outlined absolute -right-6 -bottom-6 text-[120px] opacity-10">rocket</span>
            <span className="inline-block px-2 py-0.5 bg-white/20 rounded-full text-[10px] font-bold mb-2">HOT UPDATE</span>
            <h3 className="text-xl font-bold mb-2">클린브로 v1.1.0 정식 업데이트</h3>
            <p className="text-xs text-white/80 leading-relaxed font-medium">
              대표님들의 소중한 의견을 반영하여 솔라피 자동 문자 연동 기능과 프로샵, 정교한 세무 대시보드가 추가되었습니다! 지금 가이드를 확인해 보세요.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-500 ml-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-[18px]">menu_book</span> 사용자 매뉴얼
            </h3>
            <div className="space-y-3">
              {[
                { icon: 'calendar_month', title: '📅 일정 및 예약 관리', text: '달력에서 날짜를 선택하여 당일 예약을 확인하거나, 하단 [예약] 탭에서 새 일정을 등록합니다. 항목을 길게 누르면 수정/삭제됩니다.' },
                { icon: 'photo_camera', title: '📸 작업 보고서 및 발송', text: '항목의 [작업 완료 체크]를 눌러 전/후 사진을 등록하세요. 워터마크가 첨부된 사진과 완료 메시지가 고객에게 원클릭 전송됩니다.' },
                { icon: 'sms', title: '💬 솔라피 자동 문자 연동', text: '설정에서 솔라피 API를 연동하면 예약 즉시 안내 문자 및 당일 아침 알림이 자동으로 발송되어 시간을 절약해 줍니다.' },
                { icon: 'monitoring', title: '📊 매출 및 지출/세무 관리', text: '통계 탭에서 매출 추이를 확인하고, 세무 탭에서 예상 부가세 계산 및 엑셀 자료 다운로드가 가능합니다.' },
                { icon: 'shopping_bag', title: '🛍️ 프로 샵 이용하기', text: '청소 전문가를 위한 고성능 장비를 엄선하여 최저가 링크를 제공합니다.' },
                { icon: 'install_mobile', title: '📱 앱 설치 (홈 화면 추가)', text: '아이폰(사파리 공유 > 홈 화면 추가), 안드로이드(크롬 메뉴 > 홈 화면 추가)를 통해 일반 앱처럼 사용하세요.' }
              ].map((guide, idx) => (
                <div key={idx} className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <h4 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">{guide.icon}</span>
                    {guide.title}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">{guide.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-100 dark:bg-slate-800/50 p-6 rounded-2xl text-center space-y-4 mb-10">
            <label className="flex items-center justify-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={hideNoticeAuto}
                onChange={e => {
                  const val = e.target.checked;
                  setHideNoticeAuto(val);
                  if (val) localStorage.setItem('hide_notice_v1', 'true');
                  else localStorage.removeItem('hide_notice_v1');
                }}
                className="w-4 h-4 accent-primary rounded border-slate-300"
              />
              <span className="text-[11px] font-bold text-slate-500 group-hover:text-primary transition-colors italic">다음 로그인부터는 가이드 자동 표시 안 함</span>
            </label>
            <div className="h-[1px] bg-slate-200 dark:bg-slate-700 w-1/4 mx-auto"></div>
            <p className="text-[10px] text-slate-400">버그 신고나 기능 제안은 언제든 환영합니다!</p>
            <button onClick={() => window.location.href = 'tel:01053155184'} className="mt-1 text-primary text-xs font-black underline">고객센터 연결</button>
          </div>
        </main>
      )}
      {/* ========================= [공유 모달] ========================= */}
      {pendingShare && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-end sm:items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-[2rem] w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-yellow-400 to-orange-400 p-5 text-center">
              <span className="text-4xl">✅</span>
              <h3 className="font-black text-white text-lg mt-1">작업 완료!</h3>
              <p className="text-yellow-100 text-xs mt-0.5">{pendingShare.customerName}님께 사진을 공유해 주세요</p>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-500 text-center">전/후 사진 + 가이드 이미지가 준비되었습니다</p>
              {/* 카카오톡 공유 버튼 (Web Share API - 사용자 제스처 직접 호출) */}
              <button
                onClick={async () => {
                  try {
                    if (typeof navigator.share === 'function') {
                      const shareData = {
                        text: pendingShare.text,
                        ...(pendingShare.files.length > 0 &&
                          typeof navigator.canShare === 'function' &&
                          navigator.canShare({ files: pendingShare.files })
                          ? { files: pendingShare.files } : {}),
                      };
                      await navigator.share(shareData);
                    } else {
                      window.open(pendingShare.fallbackSmsUrl, '_blank');
                    }
                  } catch (e) {
                    if (e.name !== 'AbortError') window.open(pendingShare.fallbackSmsUrl, '_blank');
                  }
                }}
                className="w-full py-3.5 bg-[#FEE500] text-[#3C1E1E] rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-md active:scale-95 transition-transform"
              >
                <span className="text-xl">💬</span> 카카오톡으로 공유하기
              </button>
              <button
                onClick={() => window.open(pendingShare.fallbackSmsUrl, '_blank')}
                className="w-full py-3 bg-slate-100 text-slate-600 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <span className="text-lg">💬</span> 문자 메시지로 공유
              </button>
              <button
                onClick={() => setPendingShare(null)}
                className="w-full py-2.5 text-slate-400 rounded-xl font-bold text-sm active:scale-95"
              >
                나중에 하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5슬롯 자동 블로그 임시저장 모달 */}
      {showBatchBlogModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-slideUp">
            
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-orange-50 to-amber-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center shadow-sm">
                  <span className="material-symbols-outlined">auto_awesome_motion</span>
                </div>
                <div>
                  <h3 className="font-black text-lg text-slate-800">5슬롯 AI 자동 임시저장 파이프라인</h3>
                  <p className="text-xs font-medium text-orange-600">사진 5세트를 등록하고 일괄로 모두 초안을 뽑아 임시저장합니다.</p>
                </div>
              </div>
              {!isBatchProcessing && (
                <button onClick={() => setShowBatchBlogModal(false)} className="text-slate-400 hover:text-slate-600 p-2 rounded-xl transition-colors bg-white/50 hover:bg-white">
                  <span className="material-symbols-outlined">close</span>
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
              {isBatchProcessing && (
                <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl flex flex-col items-center justify-center gap-3 animate-pulse">
                   <span className="material-symbols-outlined text-[32px] text-orange-500 animate-spin">sync</span>
                   <p className="font-bold text-orange-700 text-sm">{batchProgressText}</p>
                </div>
              )}

              <div className={`space-y-4 ${isBatchProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                {batchSlots.map((slot, idx) => (
                  <div key={idx} className="bg-white border-2 border-slate-100 rounded-2xl p-4 flex flex-col gap-4 shadow-sm">
                    <div className="flex items-center gap-3 w-full border-b border-slate-100 pb-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-black text-sm flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex flex-1 flex-wrap gap-2">
                        <select 
                          value={slot.category || '에어컨'} 
                          onChange={e => {
                            const newSlots = [...batchSlots];
                            newSlots[idx].category = e.target.value;
                            setBatchSlots(newSlots);
                          }} 
                          className="w-1/4 min-w-[80px] bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none font-bold text-slate-600 focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="에어컨">에어컨</option>
                          <option value="세탁기">세탁기</option>
                          <option value="인스턴티">인스턴티</option>
                          <option value="입주청소">입주청소</option>
                          <option value="기타">기타</option>
                        </select>
                        <input 
                          type="text" 
                          value={slot.product || ''} 
                          onChange={e => {
                            const newSlots = [...batchSlots];
                            newSlots[idx].product = e.target.value;
                            setBatchSlots(newSlots);
                          }} 
                          placeholder="품목" 
                          className="flex-1 min-w-[60px] bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none font-bold text-slate-600 focus:ring-2 focus:ring-orange-500" 
                        />
                        <input 
                          type="text" 
                          value={slot.customer_name || ''} 
                          onChange={e => {
                            const newSlots = [...batchSlots];
                            newSlots[idx].customer_name = e.target.value;
                            setBatchSlots(newSlots);
                          }} 
                          placeholder="고객명" 
                          className="flex-[0.8] min-w-[70px] bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none font-bold text-slate-600 focus:ring-2 focus:ring-orange-500" 
                        />
                        <input 
                          type="text" 
                          value={slot.address || ''} 
                          onChange={e => {
                            const newSlots = [...batchSlots];
                            newSlots[idx].address = e.target.value;
                            setBatchSlots(newSlots);
                          }} 
                          placeholder="지역명" 
                          className="flex-[1.2] min-w-[80px] bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm outline-none font-bold text-slate-600 focus:ring-2 focus:ring-orange-500" 
                        />
                      </div>
                    </div>
                    
                    <div className="flex w-full grid grid-cols-2 gap-3">
                      <label className={`relative flex flex-col items-center justify-center p-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${slot.beforeFiles.length > 0 ? 'border-orange-300 bg-orange-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}`}>
                        <div className="text-center">
                          <span className={`material-symbols-outlined ${slot.beforeFiles.length > 0 ? 'text-orange-500' : 'text-slate-400'}`}>{slot.beforeFiles.length > 0 ? 'check_circle' : 'add_photo_alternate'}</span>
                          <p className={`text-xs font-bold mt-1 ${slot.beforeFiles.length > 0 ? 'text-orange-700' : 'text-slate-500'}`}>
                            {slot.beforeFiles.length > 0 ? `작업 전 (${slot.beforeFiles.length})` : '작업 전 사진'}
                          </p>
                        </div>
                        {slot.beforeFiles.length > 0 && (
                          <div className="flex gap-2 mt-2 w-full overflow-x-auto pb-1 scrollbar-hide shrink-0 snap-x">
                            {slot.beforeFiles.map((f, i) => (
                              <img key={i} src={URL.createObjectURL(f)} className="w-8 h-8 rounded-md object-cover border border-orange-200 shrink-0 snap-center" title={f.name} />
                            ))}
                          </div>
                        )}
                        <input type="file" multiple accept="image/*" onChange={(e) => handleBatchImageUpload(idx, 'before', e.target.files)} className="hidden" />
                      </label>
                      <label className={`relative flex flex-col items-center justify-center p-3 border-2 border-dashed rounded-xl cursor-pointer transition-all ${slot.afterFiles.length > 0 ? 'border-orange-300 bg-orange-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}`}>
                        <div className="text-center">
                          <span className={`material-symbols-outlined ${slot.afterFiles.length > 0 ? 'text-orange-500' : 'text-slate-400'}`}>{slot.afterFiles.length > 0 ? 'check_circle' : 'add_photo_alternate'}</span>
                          <p className={`text-xs font-bold mt-1 ${slot.afterFiles.length > 0 ? 'text-orange-700' : 'text-slate-500'}`}>
                            {slot.afterFiles.length > 0 ? `작업 후 (${slot.afterFiles.length})` : '작업 후 사진'}
                          </p>
                        </div>
                        {slot.afterFiles.length > 0 && (
                          <div className="flex gap-2 mt-2 w-full overflow-x-auto pb-1 scrollbar-hide shrink-0 snap-x">
                            {slot.afterFiles.map((f, i) => (
                              <img key={i} src={URL.createObjectURL(f)} className="w-8 h-8 rounded-md object-cover border border-orange-200 shrink-0 snap-center" title={f.name} />
                            ))}
                          </div>
                        )}
                        <input type="file" multiple accept="image/*" onChange={(e) => handleBatchImageUpload(idx, 'after', e.target.files)} className="hidden" />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              {/* 큐(대기열) 대시보드 추가 */}
              {blogQueue.length > 0 && (
                <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <h4 className="text-orange-800 font-bold text-sm mb-3 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">rocket_launch</span>블로그 자동 발행 현황 ({blogQueue.length}/30)
                  </h4>
                  <div className="space-y-2">
                    {blogQueue.map((item, idx) => (
                      <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between text-xs bg-white p-3 rounded-lg border border-orange-100 shadow-sm gap-2 sm:gap-0">
                        <div className="flex-1 min-w-0 sm:pr-3">
                          <div className="font-bold text-slate-700 text-sm flex flex-wrap items-center gap-1.5 mb-1 sm:mb-0">
                            <span className="line-clamp-2 w-full sm:w-auto">{idx+1}. {item.title}</span>
                            {item.status === 'processing' && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded text-[10px] whitespace-nowrap"><span className="material-symbols-outlined text-[10px] animate-spin align-middle mr-0.5">sync</span>작성 중</span>}
                            {item.status === '작성 완료' && <span className="px-1.5 py-0.5 bg-green-100 text-green-600 rounded text-[10px] whitespace-nowrap"><span className="material-symbols-outlined text-[10px] align-middle mr-0.5">check_circle</span>발행 완료</span>}
                            {item.status === 'completed' && <span className="px-1.5 py-0.5 bg-green-100 text-green-600 rounded text-[10px] whitespace-nowrap"><span className="material-symbols-outlined text-[10px] align-middle mr-0.5">check_circle</span>발행 완료</span>}
                            {item.status === 'failed' && <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[10px] whitespace-nowrap"><span className="material-symbols-outlined text-[10px] align-middle mr-0.5">error</span>실패</span>}
                            {item.status === 'pending' && (
                              <span className={`px-1.5 py-0.5 ${item.save_as_draft ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'} rounded text-[10px] font-bold whitespace-nowrap`}>
                                {item.save_as_draft ? '임시저장 대기' : '즉시발행 대기'}
                              </span>
                            )}
                          </div>
                          <div className="text-orange-600 font-medium mt-1 inline-flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">timer</span>{item.scheduled_for_text} 예정</div>
                        </div>
                        <div className="flex justify-end gap-2 mt-2 sm:mt-0">
                          {item.status === 'failed' && (
                            <button onClick={() => retryQueueTask(item.id)} className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-lg whitespace-nowrap active:scale-95 font-bold transition-colors">
                              <span className="material-symbols-outlined text-[12px] align-middle mr-1">refresh</span>재시도
                            </button>
                          )}
                          {item.status !== 'processing' ? (
                            <button onClick={() => deleteFromQueue(item.id)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg whitespace-nowrap active:scale-95 font-bold transition-colors">기록 삭제</button>
                          ) : (
                            <span className="text-[10px] font-bold text-blue-500 whitespace-nowrap py-1.5">진행 중</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            <div className="p-4 border-t border-slate-100 flex flex-col gap-2 w-full">
              <div className="flex gap-2 w-full">
                <button 
                  onClick={() => startBatchProcess(true)} 
                  disabled={isBatchProcessing || blogQueue.length >= 30 || !batchSlots.some(s => s.beforeFiles.length > 0 && s.afterFiles.length > 0)} 
                  className="flex-1 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl font-bold text-sm shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isBatchProcessing ? (
                    <><span className="material-symbols-outlined animate-spin text-sm">sync</span>작업 중</>
                  ) : (
                    <><span className="material-symbols-outlined text-sm">bolt</span>바로 공개 시작 (즉시 발행)</>
                  )}
                </button>

                <button 
                  onClick={() => startBatchProcess(false)} 
                  disabled={isBatchProcessing || blogQueue.length >= 30 || !batchSlots.some(s => s.beforeFiles.length > 0 && s.afterFiles.length > 0)} 
                  className="flex-[1.5] py-3 bg-gradient-to-r from-orange-500 to-amber-600 text-white rounded-xl font-black text-sm shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isBatchProcessing ? (
                    <><span className="material-symbols-outlined animate-spin text-sm">sync</span>작업 중</>
                  ) : (
                    <><span className="material-symbols-outlined text-sm">rocket_launch</span>예약 발행 시작 (임시저장)</>
                  )}
                </button>
              </div>
              <button onClick={() => setShowBatchBlogModal(false)} disabled={isBatchProcessing} className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm active:scale-95 disabled:opacity-50">닫기</button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

export default App;
