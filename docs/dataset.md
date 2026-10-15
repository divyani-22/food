# Dataset Documentation

## Source
- Kaggle Food Freshness Dataset (~70k images)

## Preprocessing
- Resize: 224×224
- Normalize (ImageNet mean/std)
- Augmentation: Flip, ColorJitter, Rotation

## Fruit Classes (10 types)
apple, banana, bell_pepper, carrot, cucumber,
mango, orange, potato, strawberry, tomato

## Freshness Classes
- Original data: fresh / normal / rotten (3-class)
- Trained model: fresh / rotten (2-class)
- Final output: 3-class (the normal range is created by post-processing)

## 3-Class Mapping Rule
if p_fresh ≥ 0.7 -> fresh
if p_fresh ≤ 0.3 -> rotten
else -> normal