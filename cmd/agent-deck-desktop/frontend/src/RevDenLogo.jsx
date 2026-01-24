import logoImage from './assets/images/logo-universal.png';
import './RevDenLogo.css';

export default function RevDenLogo({ size = 'medium', showText = true, className = '' }) {
    const sizeMap = {
        small: 24,
        medium: 32,
        large: 48,
        xlarge: 80,
    };

    const imgSize = sizeMap[size] || sizeMap.medium;

    return (
        <div className={`revden-logo revden-logo-${size} ${className}`}>
            <img
                src={logoImage}
                alt="RevDen"
                width={imgSize}
                height={imgSize}
                className="revden-logo-img"
            />
            {showText && <span className="revden-logo-text">RevDen</span>}
        </div>
    );
}
