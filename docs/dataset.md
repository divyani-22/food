# Dataset Documentation

## Source
- Kaggle Food Freshness Dataset (~70k images)

## Preprocessing
- Resize: 224×224
- Normalize (ImageNet mean/std)
- Augmentation: Flip, ColorJitter, Rotation

## Fruit Classes (10종)
apple, banana, bell_pepper, carrot, cucumber,
mango, orange, potato, strawberry, tomato

## Freshness Classes
- 원본 데이터: fresh / normal / rotten (3-class)
- 학습 모델: fresh / rotten (2-class)
- 최종 출력: 3-class (후처리로 normal 구간 생성)

## 3-Class Mapping Rule
if p_fresh ≥ 0.7 -> fresh
if p_fresh ≤ 0.3 -> rotten
else -> normal