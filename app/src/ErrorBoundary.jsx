import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
                    <div className="bg-white p-6 rounded-2xl shadow-xl border border-slate-100 max-w-sm w-full text-center">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined text-4xl text-red-500">warning</span>
                        </div>
                        <h2 className="text-xl font-black text-slate-900 mb-2">화면 접속 오류</h2>
                        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                            구형 아이폰(iOS) 또는 특정 브라우저 환경에서<br />
                            화면을 불러오지 못했습니다.<br />
                            <span className="text-xs text-slate-400">(소프트웨어를 최신으로 업데이트하거나<br />크롬/사파리 최신 버전을 권장합니다)</span>
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full bg-[#2563EB] text-white font-bold py-3.5 rounded-xl shadow-lg active:scale-95 transition-all text-sm"
                        >
                            새로고침
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
