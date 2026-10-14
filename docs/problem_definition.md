# Problem Definition and Solution Strategy

## Core Problems
1. Freshness is hard to judge visually
2. Ingredient management is inefficient
3. It is hard to judge the right time to consume food
4. Lack of app/AI-based automated solutions

## FreshGuard's Solution Strategy
- EfficientNet-based freshness assessment
- Multitask model for fruit type (10 types) + freshness (2 classes: fresh/rotten)
- Post-processing rule that maps the freshness probability to 3 levels (fresh / normal / rotten)
- Server-side analysis with results delivered directly in the app
- Extensible in the future to recipe recommendations and multi-ingredient analysis
